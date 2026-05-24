/**
 * FileOperations error-path coverage tests using fs mocks.
 * These tests cover the catch branches that require fs to throw.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CacheObject } from '../CacheObject';
import { createLogEntry } from '../types';

// We need to mock fs/promises before the module is imported.
vi.mock('fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('fs/promises')>();
  return {
    ...real,
    appendFile: vi.fn(real.appendFile),
    readdir: vi.fn(real.readdir),
    stat: vi.fn(real.stat),
    unlink: vi.fn(real.unlink),
    mkdir: vi.fn(real.mkdir),
    access: vi.fn(real.access),
  };
});

import * as fs from 'fs/promises';
import {
  writeCacheObjectToDisk,
  cleanupOldLogFiles,
  needsCleanup,
  getLogDirectoryStats,
  resetDevStartupLogFileNameForTest,
} from '../FileOperations';

describe('FileOperations - mocked fs error paths', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    // NODE_ENV must be 'test' when calling resetDevStartupLogFileNameForTest
    resetDevStartupLogFileNameForTest();
    process.env.NODE_ENV = 'production';
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    vi.restoreAllMocks();
  });

  it('writeCacheObjectToDisk returns failure when appendFile throws', async () => {
    // mkdir succeeds (directory creation) but appendFile fails
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.appendFile).mockRejectedValue(new Error('disk full'));

    const cache = new CacheObject(10);
    cache.addLog(createLogEntry('INFO', 'test', 'src'));

    const result = await writeCacheObjectToDisk(cache, '/tmp/fake-log-dir');
    expect(result.success).toBe(false);
    expect(result.error).toContain('disk full');
  });

  it('cleanupOldLogFiles succeeds even if getAllLogFiles returns empty due to readdir error', async () => {
    // getAllLogFiles swallows its own errors and returns []; cleanupOldLogFiles gets []
    vi.mocked(fs.access).mockRejectedValue(new Error('no access'));

    const result = await cleanupOldLogFiles('/tmp/fake-dir');
    expect(result.success).toBe(true);
    expect(result.deletedFiles).toHaveLength(0);
  });

  it('cleanupOldLogFiles handles unlink failure gracefully (partial delete)', async () => {
    // Set up readdir to return one old log file
    vi.mocked(fs.readdir).mockResolvedValue(['openkosmos-1999-01-01.log'] as any);
    vi.mocked(fs.stat).mockResolvedValue({ size: 1024, birthtime: new Date(), mtime: new Date() } as any);
    // unlink throws but cleanupOldLogFiles should not propagate it
    vi.mocked(fs.unlink).mockRejectedValue(new Error('unlink failed'));

    const result = await cleanupOldLogFiles('/tmp/fake-dir');
    // The outer try-catch should succeed; unlink failures are swallowed
    expect(result.success).toBe(true);
    // The file was not actually deleted (unlink failed silently)
    expect(result.deletedFiles).toHaveLength(0);
  });

  it('needsCleanup returns false when getAllLogFiles (readdir) throws', async () => {
    vi.mocked(fs.readdir).mockRejectedValue(new Error('no such dir'));

    const result = await needsCleanup('/tmp/fake-dir');
    expect(result).toBe(false);
  });

  it('getLogDirectoryStats returns zeros when getAllLogFiles (readdir) throws', async () => {
    vi.mocked(fs.readdir).mockRejectedValue(new Error('no such dir'));

    const stats = await getLogDirectoryStats('/tmp/fake-dir');
    expect(stats.totalFiles).toBe(0);
    expect(stats.totalSize).toBe(0);
    expect(stats.todayFileExists).toBe(false);
  });
});
