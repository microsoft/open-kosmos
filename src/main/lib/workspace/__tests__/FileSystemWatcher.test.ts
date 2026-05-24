// @ts-nocheck
/**
 * @vitest-environment node
 *
 * Tests for workspace/FileSystemWatcher.ts
 */

import * as fs from 'fs';
import * as path from 'path';

vi.mock('fs', async (importOriginal) => {
  const orig = await importOriginal<typeof fs>();
  return {
    ...orig,
    existsSync: vi.fn(),
    promises: {
      ...orig.promises,
      stat: vi.fn(),
    },
    watch: vi.fn(),
  };
});

import { FileSystemWatcher, FileChangeType } from '../FileSystemWatcher';

const existsSync = vi.mocked(fs.existsSync);
const statMock = vi.mocked(fs.promises.stat);
const watchMock = vi.mocked(fs.watch);

function makeWatcherInstance() {
  let errorHandler: ((e: Error) => void) | null = null;
  let watchCallback: ((eventType: string, filename: string | null) => void) | null = null;

  const fakeWatcher = {
    close: vi.fn(),
    on: vi.fn((event: string, handler: any) => {
      if (event === 'error') errorHandler = handler;
    }),
    triggerError: (e: Error) => errorHandler?.(e),
    triggerEvent: (eventType: string, filename: string | null) => watchCallback?.(eventType, filename),
  };

  watchMock.mockImplementation((_path: any, _opts: any, cb: any) => {
    watchCallback = cb;
    return fakeWatcher as any;
  });

  return fakeWatcher;
}

const WATCH_PATH = '/tmp/watch-test';

describe('FileSystemWatcher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function setupValidDir() {
    existsSync.mockReturnValue(true);
    statMock.mockResolvedValue({ isDirectory: () => true } as any);
  }

  // -------------------------------------------------------------------------
  // startWatch
  // -------------------------------------------------------------------------
  it('startWatch emits ready event', async () => {
    setupValidDir();
    const fakeWatcher = makeWatcherInstance();
    const watcher = new FileSystemWatcher();

    const ready = new Promise<any>((res) => watcher.once('ready', res));
    await watcher.startWatch(WATCH_PATH);
    const info = await ready;
    expect(info.path).toBe(WATCH_PATH);
  });

  it('startWatch returns early if already watching same path', async () => {
    setupValidDir();
    makeWatcherInstance();
    const watcher = new FileSystemWatcher();
    await watcher.startWatch(WATCH_PATH);
    // Second call with same path — should be a no-op
    await watcher.startWatch(WATCH_PATH);
    expect(watchMock).toHaveBeenCalledTimes(1);
  });

  it('startWatch stops existing watcher before starting new one', async () => {
    setupValidDir();
    const fakeWatcher1 = makeWatcherInstance();
    const watcher = new FileSystemWatcher();
    await watcher.startWatch(WATCH_PATH);

    const fakeWatcher2 = makeWatcherInstance();
    await watcher.startWatch('/tmp/other-path');
    expect(fakeWatcher1.close).toHaveBeenCalled();
  });

  it('startWatch throws if path does not exist', async () => {
    existsSync.mockReturnValue(false);
    const watcher = new FileSystemWatcher();
    await expect(watcher.startWatch(WATCH_PATH)).rejects.toThrow('does not exist');
  });

  it('startWatch throws if path is not a directory', async () => {
    existsSync.mockReturnValue(true);
    statMock.mockResolvedValue({ isDirectory: () => false } as any);
    const watcher = new FileSystemWatcher();
    await expect(watcher.startWatch(WATCH_PATH)).rejects.toThrow('must be a directory');
  });

  // -------------------------------------------------------------------------
  // stopWatch
  // -------------------------------------------------------------------------
  it('stopWatch emits stopped event', async () => {
    setupValidDir();
    makeWatcherInstance();
    const watcher = new FileSystemWatcher();
    await watcher.startWatch(WATCH_PATH);

    const stopped = new Promise<void>((res) => watcher.once('stopped', res));
    await watcher.stopWatch();
    await stopped;
    expect(watcher.isWatching()).toBe(false);
  });

  it('stopWatch is a no-op when not watching', async () => {
    const watcher = new FileSystemWatcher();
    await expect(watcher.stopWatch()).resolves.toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // isWatching / getStats
  // -------------------------------------------------------------------------
  it('isWatching returns false initially', () => {
    const watcher = new FileSystemWatcher();
    expect(watcher.isWatching()).toBe(false);
  });

  it('isWatching returns true after startWatch', async () => {
    setupValidDir();
    makeWatcherInstance();
    const watcher = new FileSystemWatcher();
    await watcher.startWatch(WATCH_PATH);
    expect(watcher.isWatching()).toBe(true);
  });

  it('getStats returns correct initial state', () => {
    const watcher = new FileSystemWatcher();
    const stats = watcher.getStats();
    expect(stats.isWatching).toBe(false);
    expect(stats.watchedPath).toBeNull();
    expect(stats.changeCount).toBe(0);
  });

  it('getStats reflects started state', async () => {
    setupValidDir();
    makeWatcherInstance();
    const watcher = new FileSystemWatcher();
    await watcher.startWatch(WATCH_PATH, { recursive: true });
    const stats = watcher.getStats();
    expect(stats.isWatching).toBe(true);
    expect(stats.watchedPath).toBe(WATCH_PATH);
  });

  // -------------------------------------------------------------------------
  // File change events
  // -------------------------------------------------------------------------
  it('emits change event after flush delay for new file', async () => {
    setupValidDir();
    const fakeWatcher = makeWatcherInstance();
    existsSync
      .mockReturnValueOnce(true)   // watch path exists
      .mockReturnValueOnce(true);  // file exists (ADDED)

    const watcher = new FileSystemWatcher();
    await watcher.startWatch(WATCH_PATH);

    const changes = new Promise<any>((res) => watcher.once('change', res));
    fakeWatcher.triggerEvent('rename', 'newfile.ts');

    await vi.advanceTimersByTimeAsync(200);
    const result = await changes;
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].type).toBe(FileChangeType.ADDED);
  });

  it('emits DELETED when file no longer exists', async () => {
    setupValidDir();
    const fakeWatcher = makeWatcherInstance();
    existsSync
      .mockReturnValueOnce(true)   // watch path check
      .mockReturnValueOnce(false); // file no longer exists

    const watcher = new FileSystemWatcher();
    await watcher.startWatch(WATCH_PATH);

    const changes = new Promise<any>((res) => watcher.once('change', res));
    fakeWatcher.triggerEvent('rename', 'deleted.ts');

    await vi.advanceTimersByTimeAsync(200);
    const result = await changes;
    expect(result[0].type).toBe(FileChangeType.DELETED);
  });

  it('emits UPDATED for change event on existing file', async () => {
    setupValidDir();
    const fakeWatcher = makeWatcherInstance();
    existsSync
      .mockReturnValueOnce(true)   // watch path
      .mockReturnValueOnce(true);  // file exists

    const watcher = new FileSystemWatcher();
    await watcher.startWatch(WATCH_PATH);

    const changes = new Promise<any>((res) => watcher.once('change', res));
    fakeWatcher.triggerEvent('change', 'existing.ts');

    await vi.advanceTimersByTimeAsync(200);
    const result = await changes;
    expect(result[0].type).toBe(FileChangeType.UPDATED);
  });

  it('coalesces ADD+DELETE into no-op', async () => {
    setupValidDir();
    const fakeWatcher = makeWatcherInstance();
    let callCount = 0;
    existsSync.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return true; // watch path
      if (callCount === 2) return true; // ADD: file exists
      return false;                     // DELETE: file gone
    });

    const watcher = new FileSystemWatcher();
    await watcher.startWatch(WATCH_PATH);

    let changeReceived = false;
    watcher.on('change', () => { changeReceived = true; });

    fakeWatcher.triggerEvent('rename', 'temp.ts'); // ADDED
    fakeWatcher.triggerEvent('rename', 'temp.ts'); // DELETED

    await vi.advanceTimersByTimeAsync(200);
    // ADD then DELETE = no-op — no change should be emitted
    expect(changeReceived).toBe(false);
  });

  it('ignores null filename', async () => {
    setupValidDir();
    const fakeWatcher = makeWatcherInstance();
    const watcher = new FileSystemWatcher();
    await watcher.startWatch(WATCH_PATH);

    let changeReceived = false;
    watcher.on('change', () => { changeReceived = true; });

    fakeWatcher.triggerEvent('rename', null);
    await vi.advanceTimersByTimeAsync(200);
    expect(changeReceived).toBe(false);
  });

  it('emits error event when watcher reports error', async () => {
    setupValidDir();
    const fakeWatcher = makeWatcherInstance();
    const watcher = new FileSystemWatcher();
    await watcher.startWatch(WATCH_PATH);

    const errorEvent = new Promise<any>((res) => watcher.once('error', res));
    fakeWatcher.triggerError(new Error('watch error'));
    const errInfo = await errorEvent;
    expect(errInfo.error.message).toContain('watch error');
    expect(watcher.getStats().errorCount).toBeGreaterThan(0);
  });

  it('respects excludes pattern', async () => {
    setupValidDir();
    const fakeWatcher = makeWatcherInstance();
    existsSync
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true);

    const watcher = new FileSystemWatcher();
    await watcher.startWatch(WATCH_PATH, { excludes: ['node_modules/**'] });

    let changeReceived = false;
    watcher.on('change', () => { changeReceived = true; });

    fakeWatcher.triggerEvent('change', 'node_modules/pkg/index.js');
    await vi.advanceTimersByTimeAsync(200);
    expect(changeReceived).toBe(false);
  });

  it('respects includes pattern (only included paths pass)', async () => {
    setupValidDir();
    const fakeWatcher = makeWatcherInstance();
    existsSync
      .mockReturnValueOnce(true)  // watch path
      .mockReturnValueOnce(true)  // style.css exists
      .mockReturnValueOnce(true)  // index.ts exists
      .mockReturnValue(true);

    const watcher = new FileSystemWatcher();
    await watcher.startWatch(WATCH_PATH, { includes: ['*.ts'] });

    const receivedPaths: string[] = [];
    watcher.on('change', (changes) => {
      for (const c of changes) receivedPaths.push(c.path);
    });

    fakeWatcher.triggerEvent('change', 'style.css');
    await vi.advanceTimersByTimeAsync(200);
    fakeWatcher.triggerEvent('change', 'index.ts');
    await vi.advanceTimersByTimeAsync(200);

    expect(receivedPaths.some(p => p.includes('style.css'))).toBe(false);
    expect(receivedPaths.some(p => p.includes('index.ts'))).toBe(true);
  });

  // -------------------------------------------------------------------------
  // dispose
  // -------------------------------------------------------------------------
  it('dispose stops watching and removes all listeners', async () => {
    setupValidDir();
    makeWatcherInstance();
    const watcher = new FileSystemWatcher();
    await watcher.startWatch(WATCH_PATH);
    await watcher.dispose();
    expect(watcher.isWatching()).toBe(false);
  });
});
