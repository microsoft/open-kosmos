/**
 * @vitest-environment node
 *
 * Tests for WorkspaceWatcher.ts
 */

import * as path from 'path';
import * as os from 'os';

// ── Mocks ─────────────────────────────────────────────────────────────────────
// Use vi.hoisted so mock instances are available inside vi.mock factory closures.

const { mockSearchService, mockFileTreeService, mockFileSystemWatcher } = vi.hoisted(() => {
  const mockSearchService = {
    fileSearch: vi.fn().mockResolvedValue({ limitHit: false, results: [] }),
    clearCache: vi.fn(),
  };
  const mockFileTreeService = {
    getFileTree: vi.fn().mockResolvedValue({ tree: [] }),
    getFileList: vi.fn().mockResolvedValue([]),
    clearCache: vi.fn(),
  };
  const mockFileSystemWatcher = {
    startWatch: vi.fn().mockResolvedValue(undefined),
    stopWatch: vi.fn().mockResolvedValue(undefined),
    isWatching: vi.fn().mockReturnValue(false),
    getStats: vi.fn().mockReturnValue({ watchedPaths: [], eventCount: 0 }),
    dispose: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    emit: vi.fn(),
    removeAllListeners: vi.fn(),
  };
  return { mockSearchService, mockFileTreeService, mockFileSystemWatcher };
});

vi.mock('../SearchService', () => {
  return {
    WorkspaceSearchService: class {
      fileSearch = mockSearchService.fileSearch;
      clearCache = mockSearchService.clearCache;
    },
  };
});

vi.mock('../FileTreeService', () => {
  return {
    FileTreeService: class {
      getFileTree = mockFileTreeService.getFileTree;
      getFileList = mockFileTreeService.getFileList;
      clearCache = mockFileTreeService.clearCache;
    },
  };
});

vi.mock('../FileSystemWatcher', () => {
  return {
    FileSystemWatcher: class {
      startWatch = mockFileSystemWatcher.startWatch;
      stopWatch = mockFileSystemWatcher.stopWatch;
      isWatching = mockFileSystemWatcher.isWatching;
      getStats = mockFileSystemWatcher.getStats;
      dispose = mockFileSystemWatcher.dispose;
      on = mockFileSystemWatcher.on;
      emit = mockFileSystemWatcher.emit;
      removeAllListeners = mockFileSystemWatcher.removeAllListeners;
    },
  };
});

// Mock fs for path validation in startFileWatch
vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
  statSync: vi.fn().mockReturnValue({ isDirectory: () => true }),
}));

import * as fs from 'fs';
import {
  WorkspaceWatcher,
  getWorkspaceWatcher,
  disposeWorkspaceWatcher,
} from '../WorkspaceWatcher';

const existsSync = vi.mocked(fs.existsSync);
const statSync = vi.mocked(fs.statSync);

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeWatcher(): WorkspaceWatcher {
  return new WorkspaceWatcher();
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('WorkspaceWatcher — searchFiles', () => {
  it('delegates to searchService.fileSearch', async () => {
    const watcher = makeWatcher();
    const query = { folder: '/tmp', pattern: 'foo' } as any;
    const cb = vi.fn();
    const result = await watcher.searchFiles(query, cb);
    expect(mockSearchService.fileSearch).toHaveBeenCalledWith(query, cb);
    expect(result).toBeDefined();
  });
});

describe('WorkspaceWatcher — getFileTree', () => {
  it('delegates to fileTreeService.getFileTree', async () => {
    const watcher = makeWatcher();
    const query = { folder: '/tmp' } as any;
    const result = await watcher.getFileTree(query);
    expect(mockFileTreeService.getFileTree).toHaveBeenCalledWith(query);
    expect(result).toBeDefined();
  });
});

describe('WorkspaceWatcher — getFileList', () => {
  it('delegates to fileTreeService.getFileList', async () => {
    const watcher = makeWatcher();
    const query = { folder: '/tmp' } as any;
    const result = await watcher.getFileList(query);
    expect(mockFileTreeService.getFileList).toHaveBeenCalledWith(query);
    expect(Array.isArray(result)).toBe(true);
  });
});

describe('WorkspaceWatcher — clearFileTreeCache', () => {
  it('delegates to fileTreeService.clearCache without folder', () => {
    const watcher = makeWatcher();
    watcher.clearFileTreeCache();
    expect(mockFileTreeService.clearCache).toHaveBeenCalledWith(undefined);
  });

  it('delegates to fileTreeService.clearCache with folder', () => {
    const watcher = makeWatcher();
    watcher.clearFileTreeCache('/some/folder');
    expect(mockFileTreeService.clearCache).toHaveBeenCalledWith('/some/folder');
  });
});

describe('WorkspaceWatcher — isWatchingFiles / getWatcherStats', () => {
  it('returns false by default', () => {
    const watcher = makeWatcher();
    expect(watcher.isWatchingFiles()).toBe(false);
  });

  it('returns stats from fileSystemWatcher', () => {
    const watcher = makeWatcher();
    const stats = watcher.getWatcherStats();
    expect(stats).toBeDefined();
  });
});

describe('WorkspaceWatcher — startFileWatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    existsSync.mockReturnValue(true);
    statSync.mockReturnValue({ isDirectory: () => true } as any);
    mockFileSystemWatcher.startWatch.mockResolvedValue(undefined);
  });

  it('starts watching a valid absolute directory', async () => {
    const watcher = makeWatcher();
    const tmpDir = os.tmpdir();
    await expect(watcher.startFileWatch(tmpDir)).resolves.toBeUndefined();
    expect(mockFileSystemWatcher.startWatch).toHaveBeenCalled();
  });

  it('passes excludes option through to fileSystemWatcher', async () => {
    const watcher = makeWatcher();
    const tmpDir = os.tmpdir();
    await watcher.startFileWatch(tmpDir, { excludes: ['custom/**'] });
    const callArgs = mockFileSystemWatcher.startWatch.mock.calls[0];
    const opts = callArgs[1];
    // The ...options spread at end overwrites excludes with user's value
    // so user excludes are present
    expect(opts.excludes).toContain('custom/**');
  });

  it('defaults recursive to true', async () => {
    const watcher = makeWatcher();
    const tmpDir = os.tmpdir();
    await watcher.startFileWatch(tmpDir);
    const opts = mockFileSystemWatcher.startWatch.mock.calls[0][1];
    expect(opts.recursive).toBe(true);
  });

  it('throws for relative path', async () => {
    const watcher = makeWatcher();
    await expect(watcher.startFileWatch('relative/path')).rejects.toThrow('Invalid watch path');
  });

  it('throws for empty string', async () => {
    const watcher = makeWatcher();
    await expect(watcher.startFileWatch('')).rejects.toThrow('Invalid watch path');
  });

  it('throws when path does not exist', async () => {
    existsSync.mockReturnValue(false);
    const watcher = makeWatcher();
    await expect(watcher.startFileWatch('/nonexistent/absolute')).rejects.toThrow('Invalid watch path');
  });

  it('throws when path is a file, not a directory', async () => {
    statSync.mockReturnValue({ isDirectory: () => false } as any);
    const watcher = makeWatcher();
    await expect(watcher.startFileWatch('/some/file.txt')).rejects.toThrow('Invalid watch path');
  });

  it('throws for dangerous system path /System', async () => {
    const watcher = makeWatcher();
    // Mock it to look like a valid directory on fs level
    existsSync.mockReturnValue(true);
    statSync.mockReturnValue({ isDirectory: () => true } as any);
    await expect(watcher.startFileWatch('/System')).rejects.toThrow('Invalid watch path');
  });

  it('throws for /usr/bin path', async () => {
    const watcher = makeWatcher();
    existsSync.mockReturnValue(true);
    statSync.mockReturnValue({ isDirectory: () => true } as any);
    await expect(watcher.startFileWatch('/usr/bin')).rejects.toThrow('Invalid watch path');
  });

  it('throws for /bin path', async () => {
    const watcher = makeWatcher();
    existsSync.mockReturnValue(true);
    statSync.mockReturnValue({ isDirectory: () => true } as any);
    await expect(watcher.startFileWatch('/bin')).rejects.toThrow('Invalid watch path');
  });

  it('throws when statSync throws', async () => {
    existsSync.mockReturnValue(true);
    statSync.mockImplementation(() => { throw new Error('permission denied'); });
    const watcher = makeWatcher();
    await expect(watcher.startFileWatch('/some/absolute/path')).rejects.toThrow('Invalid watch path');
  });
});

describe('WorkspaceWatcher — stopFileWatch', () => {
  it('calls fileSystemWatcher.stopWatch', async () => {
    const watcher = makeWatcher();
    await watcher.stopFileWatch();
    expect(mockFileSystemWatcher.stopWatch).toHaveBeenCalled();
  });
});

describe('WorkspaceWatcher — dispose', () => {
  it('disposes all services and removes listeners', async () => {
    const watcher = makeWatcher();
    await watcher.dispose();
    expect(mockFileSystemWatcher.dispose).toHaveBeenCalled();
    expect(mockSearchService.clearCache).toHaveBeenCalled();
    expect(mockFileTreeService.clearCache).toHaveBeenCalled();
  });
});

describe('WorkspaceWatcher — event forwarding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    existsSync.mockReturnValue(true);
    statSync.mockReturnValue({ isDirectory: () => true } as any);
  });

  it('forwards fileSystemWatcher change event as fileChanged', () => {
    const watcher = makeWatcher();
    // Find handler registered by THIS watcher (last 'change' call)
    const calls = (mockFileSystemWatcher.on as any).mock.calls;
    const changeCall = [...calls].reverse().find((c: any[]) => c[0] === 'change');
    expect(changeCall).toBeDefined();
    const handler = changeCall[1];
    const received: any[] = [];
    watcher.on('fileChanged', (changes: any) => received.push(changes));
    const fakeChanges = [{ type: 'created', path: '/a/b' }];
    handler(fakeChanges);
    expect(received[0]).toBe(fakeChanges);
  });

  it('forwards error event as watchError', () => {
    const watcher = makeWatcher();
    const calls = (mockFileSystemWatcher.on as any).mock.calls;
    const errorCall = [...calls].reverse().find((c: any[]) => c[0] === 'error');
    expect(errorCall).toBeDefined();
    const handler = errorCall[1];
    const received: any[] = [];
    watcher.on('watchError', (err: any) => received.push(err));
    const fakeErr = new Error('watch failed');
    handler({ error: fakeErr, path: '/tmp' });
    expect(received[0]).toBe(fakeErr);
  });

  it('forwards ready event as watchReady', () => {
    const watcher = makeWatcher();
    const calls = (mockFileSystemWatcher.on as any).mock.calls;
    const readyCall = [...calls].reverse().find((c: any[]) => c[0] === 'ready');
    expect(readyCall).toBeDefined();
    const handler = readyCall[1];
    const received: any[] = [];
    watcher.on('watchReady', (info: any) => received.push(info));
    handler({ path: '/tmp' });
    expect(received[0]).toEqual({ path: '/tmp' });
  });

  it('forwards stopped event as watchStopped', () => {
    const watcher = makeWatcher();
    const calls = (mockFileSystemWatcher.on as any).mock.calls;
    const stoppedCall = [...calls].reverse().find((c: any[]) => c[0] === 'stopped');
    expect(stoppedCall).toBeDefined();
    const handler = stoppedCall[1];
    const received: any[] = [];
    watcher.on('watchStopped', () => received.push(true));
    handler();
    expect(received.length).toBe(1);
  });
});

describe('getWorkspaceWatcher / disposeWorkspaceWatcher', () => {
  it('returns the same instance on repeated calls', () => {
    const a = getWorkspaceWatcher();
    const b = getWorkspaceWatcher();
    expect(a).toBe(b);
  });

  it('creates a new instance after dispose', async () => {
    const a = getWorkspaceWatcher();
    await disposeWorkspaceWatcher();
    const b = getWorkspaceWatcher();
    expect(a).not.toBe(b);
    // Cleanup
    await disposeWorkspaceWatcher();
  });

  it('disposeWorkspaceWatcher is a no-op when already null', async () => {
    await disposeWorkspaceWatcher(); // ensure null
    await expect(disposeWorkspaceWatcher()).resolves.toBeUndefined();
  });
});
