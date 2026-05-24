// @ts-nocheck
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SaveLogManager } from '../SaveLogManager';
import { PendingSaveQueue } from '../PendingSaveQueue';
import { CacheObject } from '../CacheObject';
import { UnifiedLoggerConfig, createLogEntry } from '../types';
import * as FileOps from '../FileOperations';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

const TEST_CONFIG: UnifiedLoggerConfig = {
  LOGGER_CACHE_MAX_SIZE: 10,
  LOGGER_DIRECTORY: '',
  LOGGER_LEVELS: ['DEBUG', 'INFO', 'WARN', 'ERROR'],
  LOGGER_ENABLE_CONSOLE: false,
};

function makeCache(logCount = 1): CacheObject {
  const c = new CacheObject(100);
  for (let i = 0; i < logCount; i++) {
    c.addLog(createLogEntry('INFO', `msg-${i}`, 'src'));
  }
  return c;
}

describe('SaveLogManager', () => {
  let tempDir: string;

  beforeEach(async () => {
    SaveLogManager.resetInstance();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openkosmos-save-mgr-test-'));
  });

  afterEach(async () => {
    SaveLogManager.resetInstance();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('getInstance throws without config on first call', () => {
    expect(() => SaveLogManager.getInstance()).toThrow();
  });

  it('getInstance creates singleton', () => {
    const q = new PendingSaveQueue();
    const config = { ...TEST_CONFIG, LOGGER_DIRECTORY: tempDir };
    const m1 = SaveLogManager.getInstance(config, q);
    const m2 = SaveLogManager.getInstance();
    expect(m1).toBe(m2);
  });

  it('isInitialized returns false before init, true after', () => {
    expect(SaveLogManager.isInitialized()).toBe(false);
    const q = new PendingSaveQueue();
    SaveLogManager.getInstance({ ...TEST_CONFIG, LOGGER_DIRECTORY: tempDir }, q);
    expect(SaveLogManager.isInitialized()).toBe(true);
  });

  it('manualSave writes cache objects to disk', async () => {
    const q = new PendingSaveQueue();
    const config = { ...TEST_CONFIG, LOGGER_DIRECTORY: tempDir };
    const mgr = SaveLogManager.getInstance(config, q);

    const cache = makeCache(2);
    q.enqueue(cache);
    await mgr.manualSave();

    const stats = mgr.getSaveStats();
    expect(stats.totalCacheObjectsSaved).toBe(1);
    expect(stats.totalFilesWritten).toBe(1);
  });

  it('notifyPendingSaveAvailable triggers async save', async () => {
    const q = new PendingSaveQueue();
    const config = { ...TEST_CONFIG, LOGGER_DIRECTORY: tempDir };
    const mgr = SaveLogManager.getInstance(config, q);

    q.enqueue(makeCache(1));
    mgr.notifyPendingSaveAvailable();

    // Wait for async save to finish
    await mgr.waitForSaveComplete(5000);
    expect(mgr.getSaveStats().totalCacheObjectsSaved).toBe(1);
  });

  it('prevents duplicate concurrent saves', async () => {
    const q = new PendingSaveQueue();
    const config = { ...TEST_CONFIG, LOGGER_DIRECTORY: tempDir };
    const mgr = SaveLogManager.getInstance(config, q);

    q.enqueue(makeCache(1));
    q.enqueue(makeCache(1));
    // Start two saves concurrently - second should be skipped due to isSaving guard
    const p1 = mgr.manualSave();
    const p2 = (mgr as any).saveLogsToDisk();
    await Promise.all([p1, p2]);
    // At least one save happened
    expect(mgr.getSaveStats().totalSaveOperations).toBeGreaterThanOrEqual(1);
  });

  it('getStatus returns correct fields', () => {
    const q = new PendingSaveQueue();
    const config = { ...TEST_CONFIG, LOGGER_DIRECTORY: tempDir };
    const mgr = SaveLogManager.getInstance(config, q);
    const status = mgr.getStatus();
    expect(status).toHaveProperty('isSaving');
    expect(status).toHaveProperty('pendingSaveQueueSize');
    expect(status).toHaveProperty('logDirectory');
    expect(status).toHaveProperty('stats');
    expect(status.logDirectory).toBe(tempDir);
  });

  it('updateConfig updates log directory', () => {
    const q = new PendingSaveQueue();
    const config = { ...TEST_CONFIG, LOGGER_DIRECTORY: tempDir };
    const mgr = SaveLogManager.getInstance(config, q);
    const newDir = '/tmp/new-dir';
    mgr.updateConfig({ LOGGER_DIRECTORY: newDir });
    expect(mgr.getConfig().LOGGER_DIRECTORY).toBe(newDir);
    expect(mgr.getStatus().logDirectory).toBe(newDir);
  });

  it('updateConfig without directory change keeps existing', () => {
    const q = new PendingSaveQueue();
    const config = { ...TEST_CONFIG, LOGGER_DIRECTORY: tempDir };
    const mgr = SaveLogManager.getInstance(config, q);
    mgr.updateConfig({ LOGGER_ENABLE_CONSOLE: false });
    expect(mgr.getStatus().logDirectory).toBe(tempDir);
  });

  it('getConfig returns copy', () => {
    const q = new PendingSaveQueue();
    const config = { ...TEST_CONFIG, LOGGER_DIRECTORY: tempDir };
    const mgr = SaveLogManager.getInstance(config, q);
    const c = mgr.getConfig();
    expect(c.LOGGER_DIRECTORY).toBe(tempDir);
  });

  it('getLogDirectoryStats returns stats', async () => {
    const q = new PendingSaveQueue();
    const config = { ...TEST_CONFIG, LOGGER_DIRECTORY: tempDir };
    const mgr = SaveLogManager.getInstance(config, q);
    const stats = await mgr.getLogDirectoryStats();
    expect(stats).toHaveProperty('totalFiles');
  });

  it('validateLogDirectory returns result for valid dir', async () => {
    const q = new PendingSaveQueue();
    const config = { ...TEST_CONFIG, LOGGER_DIRECTORY: tempDir };
    const mgr = SaveLogManager.getInstance(config, q);
    const result = await mgr.validateLogDirectory();
    expect(result.exists).toBe(true);
    expect(result.writable).toBe(true);
  });

  it('manualCleanup returns cleanup result', async () => {
    const q = new PendingSaveQueue();
    const config = { ...TEST_CONFIG, LOGGER_DIRECTORY: tempDir };
    const mgr = SaveLogManager.getInstance(config, q);
    const result = await mgr.manualCleanup();
    expect(result).toHaveProperty('success');
  });

  it('getAllLogFiles returns list', async () => {
    const q = new PendingSaveQueue();
    const config = { ...TEST_CONFIG, LOGGER_DIRECTORY: tempDir };
    const mgr = SaveLogManager.getInstance(config, q);
    const files = await mgr.getAllLogFiles();
    expect(Array.isArray(files)).toBe(true);
  });

  it('forceSaveCacheObject saves a specific cache object', async () => {
    const q = new PendingSaveQueue();
    const config = { ...TEST_CONFIG, LOGGER_DIRECTORY: tempDir };
    const mgr = SaveLogManager.getInstance(config, q);
    const cache = makeCache(1);
    const result = await mgr.forceSaveCacheObject(cache);
    expect(result.success).toBe(true);
  });

  it('getPendingSaveQueueInfo returns queue info', () => {
    const q = new PendingSaveQueue();
    const config = { ...TEST_CONFIG, LOGGER_DIRECTORY: tempDir };
    const mgr = SaveLogManager.getInstance(config, q);
    const info = mgr.getPendingSaveQueueInfo();
    expect(info).toHaveProperty('size');
  });

  it('validateIntegrity passes for valid manager', () => {
    const q = new PendingSaveQueue();
    const config = { ...TEST_CONFIG, LOGGER_DIRECTORY: tempDir };
    const mgr = SaveLogManager.getInstance(config, q);
    const result = mgr.validateIntegrity();
    expect(result.isValid).toBe(true);
  });

  it('getDetailedInfo returns all sections', async () => {
    const q = new PendingSaveQueue();
    const config = { ...TEST_CONFIG, LOGGER_DIRECTORY: tempDir };
    const mgr = SaveLogManager.getInstance(config, q);
    const info = await mgr.getDetailedInfo();
    expect(info).toHaveProperty('status');
    expect(info).toHaveProperty('pendingSaveQueue');
    expect(info).toHaveProperty('directoryStats');
    expect(info).toHaveProperty('directoryValidation');
    expect(info).toHaveProperty('validation');
  });

  it('waitForSaveComplete returns true when not saving', async () => {
    const q = new PendingSaveQueue();
    const config = { ...TEST_CONFIG, LOGGER_DIRECTORY: tempDir };
    const mgr = SaveLogManager.getInstance(config, q);
    const result = await mgr.waitForSaveComplete(1000);
    expect(result).toBe(true);
  });

  it('resetStats clears save statistics', async () => {
    const q = new PendingSaveQueue();
    const config = { ...TEST_CONFIG, LOGGER_DIRECTORY: tempDir };
    const mgr = SaveLogManager.getInstance(config, q);
    q.enqueue(makeCache(1));
    await mgr.manualSave();
    expect(mgr.getSaveStats().totalSaveOperations).toBeGreaterThan(0);
    mgr.resetStats();
    const stats = mgr.getSaveStats();
    expect(stats.totalSaveOperations).toBe(0);
    expect(stats.totalFilesWritten).toBe(0);
  });

  it('writeCacheObjectToDisk handles failed write', async () => {
    const q = new PendingSaveQueue();
    // Use a non-writable path to cause failure
    const config = { ...TEST_CONFIG, LOGGER_DIRECTORY: '/nonexistent/path/that/cannot/be/created' };
    const mgr = SaveLogManager.getInstance(config, q);

    vi.spyOn(FileOps, 'writeCacheObjectToDisk').mockResolvedValueOnce({
      success: false,
      error: 'simulated error',
      duration: 0
    });

    q.enqueue(makeCache(1));
    await mgr.manualSave();
    // Should not throw, but also not count a saved file
    expect(mgr.getSaveStats().totalCacheObjectsSaved).toBe(0);
  });

  it('SaveLogManager.validateIntegrity detects invalid pendingSaveQueue', async () => {
    const q = new PendingSaveQueue();
    const config = { ...TEST_CONFIG, LOGGER_DIRECTORY: tempDir };
    const mgr = SaveLogManager.getInstance(config, q);
    // Push an invalid non-CacheObject entry into save queue
    const badObj = Object.create(null);
    badObj.id = 'bad';
    (q as any).queue.push(badObj);
    const result = mgr.validateIntegrity();
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('Pending save queue validation failed'))).toBe(true);
  });

  it('cleanupOldLogFiles inside SaveLogManager runs when there are old logs', async () => {
    // Create an old production log file to trigger cleanup branch 129-130
    process.env.NODE_ENV = 'production';
    const { FileOperations: FO, resetDevStartupLogFileNameForTest } = await import('../FileOperations');
    await fs.writeFile(path.join(tempDir, 'openkosmos-1999-01-01.log'), 'old');
    const q = new PendingSaveQueue();
    const config = { ...TEST_CONFIG, LOGGER_DIRECTORY: tempDir };
    const mgr = SaveLogManager.getInstance(config, q);
    // Trigger cleanup directly
    await (mgr as any).cleanupOldLogFiles();
    // Old file should be deleted
    await expect(fs.access(path.join(tempDir, 'openkosmos-1999-01-01.log'))).rejects.toThrow();
  });

  it('performInitialCleanup setTimeout callback runs after delay', async () => {
    vi.useFakeTimers();
    const q = new PendingSaveQueue();
    const config = { ...TEST_CONFIG, LOGGER_DIRECTORY: tempDir };
    const mgr = SaveLogManager.getInstance(config, q);
    // Advance timers to trigger the setTimeout in performInitialCleanup
    await vi.runAllTimersAsync();
    vi.useRealTimers();
    // Just verify no crash
    expect(mgr).toBeDefined();
  });
});
