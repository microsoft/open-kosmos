/**
 * workspace.ts IPC handler branch coverage.
 *
 * Targets branches the main coverage suite leaves out: the non-Error catch
 * paths (`error instanceof Error ? ... : 'Unknown error'`), convertNodeFormat
 * edge cases (relative paths, metadata, stat failures, null children), the
 * file-watch event callbacks, and a few copy/move recursion paths.
 */

const { mockHandle, mockShowOpenDialog, mockShellOpenPath, mockShellShowItemInFolder } = vi.hoisted(() => ({
  mockHandle: vi.fn(),
  mockShowOpenDialog: vi.fn(),
  mockShellOpenPath: vi.fn().mockResolvedValue(''),
  mockShellShowItemInFolder: vi.fn(),
}));

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/mock/userData') },
  ipcMain: { handle: (...args: any[]) => mockHandle(...args) },
  shell: {
    openPath: (...args: any[]) => mockShellOpenPath(...args),
    showItemInFolder: (...args: any[]) => mockShellShowItemInFolder(...args),
  },
  dialog: { showOpenDialog: (...args: any[]) => mockShowOpenDialog(...args) },
}));

const { mockFsExistsSync, mockFsStatSync, mockFsReaddirSync, mockFsMkdirSync, mockFsCopyFileSync, mockFsRenameSync, mockFsRmSync, mockFsUnlinkSync } = vi.hoisted(() => ({
  mockFsExistsSync: vi.fn().mockReturnValue(true),
  mockFsStatSync: vi.fn().mockReturnValue({ isDirectory: () => false, size: 100, mtimeMs: 123 }),
  mockFsReaddirSync: vi.fn().mockReturnValue([]),
  mockFsMkdirSync: vi.fn(),
  mockFsCopyFileSync: vi.fn(),
  mockFsRenameSync: vi.fn(),
  mockFsRmSync: vi.fn(),
  mockFsUnlinkSync: vi.fn(),
}));

vi.mock('fs', () => ({
  existsSync: (...args: any[]) => mockFsExistsSync(...args),
  statSync: (...args: any[]) => mockFsStatSync(...args),
  readdirSync: (...args: any[]) => mockFsReaddirSync(...args),
  mkdirSync: (...args: any[]) => mockFsMkdirSync(...args),
  copyFileSync: (...args: any[]) => mockFsCopyFileSync(...args),
  renameSync: (...args: any[]) => mockFsRenameSync(...args),
  rmSync: (...args: any[]) => mockFsRmSync(...args),
  unlinkSync: (...args: any[]) => mockFsUnlinkSync(...args),
}));

const { mockWatcher } = vi.hoisted(() => ({
  mockWatcher: {
    getFileTree: vi.fn().mockResolvedValue({ root: { children: [] } }),
    clearFileTreeCache: vi.fn(),
    startFileWatch: vi.fn().mockResolvedValue(undefined),
    stopFileWatch: vi.fn().mockResolvedValue(undefined),
    getWatcherStats: vi.fn().mockReturnValue({ watching: true }),
    searchFiles: vi.fn().mockResolvedValue({ results: [] }),
    listenerCount: vi.fn().mockReturnValue(0),
    on: vi.fn(),
  },
}));

vi.mock('../../../lib/workspace/WorkspaceWatcher', () => ({
  getWorkspaceWatcher: () => mockWatcher,
}));

const mockGetDefaultWorkspacePath = vi.fn().mockReturnValue('/default/workspace/path');
vi.mock('../../../lib/userDataADO/pathUtils', () => ({
  getDefaultWorkspacePath: (...args: any[]) => mockGetDefaultWorkspacePath(...args),
}));

const mockLogger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
vi.mock('../lazy', () => ({ getAdvancedLogger: () => mockLogger }));

const { mockCollectImportConflicts, mockPlanImportTargets, mockPromptImportConflictResolution } = vi.hoisted(() => ({
  mockCollectImportConflicts: vi.fn().mockReturnValue([]),
  mockPlanImportTargets: vi.fn().mockReturnValue([]),
  mockPromptImportConflictResolution: vi.fn().mockResolvedValue('replace'),
}));

vi.mock('../shared', () => ({
  collectImportConflicts: (...args: any[]) => mockCollectImportConflicts(...args),
  planImportTargets: (...args: any[]) => mockPlanImportTargets(...args),
  promptImportConflictResolution: (...args: any[]) => mockPromptImportConflictResolution(...args),
}));

import registerWorkspace from '../workspace';

type HandlerFn = (event: any, ...args: any[]) => Promise<any>;

function registerAndCollect(ctx: any): Map<string, HandlerFn> {
  const handlers = new Map<string, HandlerFn>();
  mockHandle.mockImplementation((channel: string, fn: HandlerFn) => { handlers.set(channel, fn); });
  registerWorkspace(ctx);
  return handlers;
}

const fakeEvent = { sender: { isDestroyed: () => false, send: vi.fn() } } as any;

describe('workspace IPC – non-Error catch paths', () => {
  let handlers: Map<string, HandlerFn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFsExistsSync.mockReturnValue(true);
    mockFsStatSync.mockReturnValue({ isDirectory: () => false, size: 100, mtimeMs: 123 });
    mockFsReaddirSync.mockReturnValue([]);
    mockWatcher.listenerCount.mockReturnValue(0);
    handlers = registerAndCollect({ mainWindow: { id: 1 } });
  });

  it('selectFolder maps a non-Error rejection to Unknown error', async () => {
    mockShowOpenDialog.mockRejectedValue('boom');
    const r = await handlers.get('workspace:selectFolder')!(fakeEvent);
    expect(r.error).toBe('Unknown error');
  });

  it('getFileTree maps a non-Error rejection to Unknown error', async () => {
    mockWatcher.getFileTree.mockRejectedValue('boom');
    const r = await handlers.get('workspace:getFileTree')!(fakeEvent, '/workspace');
    expect(r.error).toBe('Unknown error');
  });

  it('clearFileTreeCache maps a non-Error throw to Unknown error', async () => {
    mockWatcher.clearFileTreeCache.mockImplementation(() => { throw 'boom'; });
    const r = await handlers.get('workspace:clearFileTreeCache')!(fakeEvent);
    expect(r.error).toBe('Unknown error');
  });

  it('getDirectoryChildren maps a non-Error throw to Unknown error', async () => {
    mockFsReaddirSync.mockImplementation(() => { throw 'boom'; });
    const r = await handlers.get('workspace:getDirectoryChildren')!(fakeEvent, '/dir');
    expect(r.error).toBe('Unknown error');
  });

  it('startWatch maps a non-Error rejection to Unknown error', async () => {
    mockWatcher.startFileWatch.mockRejectedValue('boom');
    const r = await handlers.get('workspace:startWatch')!(fakeEvent, '/workspace');
    expect(r.error).toBe('Unknown error');
  });

  it('stopWatch maps a non-Error rejection to Unknown error', async () => {
    mockWatcher.stopFileWatch.mockRejectedValue('boom');
    const r = await handlers.get('workspace:stopWatch')!(fakeEvent);
    expect(r.error).toBe('Unknown error');
  });

  it('getWatcherStats maps a non-Error throw to Unknown error', async () => {
    mockWatcher.getWatcherStats.mockImplementation(() => { throw 'boom'; });
    const r = await handlers.get('workspace:getWatcherStats')!(fakeEvent);
    expect(r.error).toBe('Unknown error');
  });

  it('searchFiles maps a non-Error rejection to Unknown error', async () => {
    mockWatcher.searchFiles.mockRejectedValue('boom');
    const r = await handlers.get('workspace:searchFiles')!(fakeEvent, { folder: '/workspace' });
    expect(r.error).toBe('Unknown error');
  });

  it('movePath maps a non-Error throw to Unknown error', async () => {
    mockFsExistsSync.mockImplementation(() => { throw 'boom'; });
    const r = await handlers.get('workspace:movePath')!(fakeEvent, '/src', '/dest');
    expect(r.error).toBe('Unknown error');
  });

  it('openPath maps a non-Error rejection to Unknown error', async () => {
    mockFsExistsSync.mockReturnValue(true);
    mockShellOpenPath.mockRejectedValue('boom');
    const r = await handlers.get('workspace:openPath')!(fakeEvent, '/file');
    expect(r.error).toBe('Unknown error');
  });

  it('showInFolder maps a non-Error throw to Unknown error', async () => {
    mockFsExistsSync.mockReturnValue(true);
    mockShellShowItemInFolder.mockImplementation(() => { throw 'boom'; });
    const r = await handlers.get('workspace:showInFolder')!(fakeEvent, '/file');
    expect(r.error).toBe('Unknown error');
  });

  it('getDefaultWorkspacePath maps a non-Error throw to Unknown error', async () => {
    mockGetDefaultWorkspacePath.mockImplementation(() => { throw 'boom'; });
    const r = await handlers.get('workspace:getDefaultWorkspacePath')!(fakeEvent, 'user', 'chat');
    expect(r.error).toBe('Unknown error');
  });
});

describe('workspace IPC – getFileTree node conversion', () => {
  let handlers: Map<string, HandlerFn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFsExistsSync.mockReturnValue(true);
    handlers = registerAndCollect({ mainWindow: { id: 1 } });
  });

  it('resolves relative node paths, attaches metadata, and tolerates stat failures', async () => {
    const workspace = '/workspace';
    // file with relative path + includeMetadata; directory with metadata; a null child.
    mockFsStatSync.mockImplementation((p: string) => {
      if (p.endsWith('boom.txt')) throw new Error('stat failed');
      return { size: 64, mtimeMs: 999 };
    });
    mockWatcher.getFileTree.mockResolvedValue({
      root: {
        children: [
          { name: 'rel.txt', path: 'rel.txt', isDirectory: false, children: [] },
          { name: 'boom.txt', path: '/workspace/boom.txt', isDirectory: false, children: [] },
          {
            name: 'dir',
            path: '/workspace/dir',
            isDirectory: true,
            children: [
              { name: 'child.txt', path: '/workspace/dir/child.txt', isDirectory: false, children: [] },
              null,
            ],
          },
        ],
      },
    });
    const r = await handlers.get('workspace:getFileTree')!(fakeEvent, workspace, { includeMetadata: true });
    expect(r.success).toBe(true);
    const names = r.data.tree.map((n: any) => n.name);
    expect(names).toContain('rel.txt');
    expect(names).toContain('dir');
    const dir = r.data.tree.find((n: any) => n.name === 'dir');
    expect(dir.type).toBe('directory');
    expect(dir.mtime).toBe(999);
    const boom = r.data.tree.find((n: any) => n.name === 'boom.txt');
    expect(boom.size).toBe(0);
  });

  it('tolerates a directory whose metadata stat throws', async () => {
    mockFsStatSync.mockImplementation(() => { throw new Error('stat failed'); });
    mockWatcher.getFileTree.mockResolvedValue({
      root: {
        children: [
          { name: 'dir', path: '/workspace/dir', isDirectory: true, children: [] },
        ],
      },
    });
    const r = await handlers.get('workspace:getFileTree')!(fakeEvent, '/workspace', { includeMetadata: true });
    expect(r.success).toBe(true);
    expect(r.data.tree[0].type).toBe('directory');
  });

  it('returns an empty tree when the root has no children', async () => {
    mockWatcher.getFileTree.mockResolvedValue({ root: {} });
    const r = await handlers.get('workspace:getFileTree')!(fakeEvent, '/workspace');
    expect(r.success).toBe(true);
    expect(r.data.tree).toEqual([]);
  });
});

describe('workspace IPC – getDirectoryChildren metadata & symlinks', () => {
  let handlers: Map<string, HandlerFn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFsExistsSync.mockReturnValue(true);
    handlers = registerAndCollect({ mainWindow: { id: 1 } });
  });

  it('resolves symlinked directories and attaches metadata for files and directories', async () => {
    mockFsReaddirSync.mockReturnValue([
      { name: 'linkdir', isDirectory: () => false, isSymbolicLink: () => true },
      { name: 'plain.txt', isDirectory: () => false, isSymbolicLink: () => false },
      { name: 'realdir', isDirectory: () => true, isSymbolicLink: () => false },
    ]);
    mockFsStatSync.mockImplementation((p: string) => {
      if (p.endsWith('linkdir')) return { isDirectory: () => true, size: 0, mtimeMs: 1 };
      if (p.endsWith('plain.txt')) return { isDirectory: () => false, size: 7, mtimeMs: 2 };
      return { isDirectory: () => true, size: 0, mtimeMs: 3 };
    });
    const r = await handlers.get('workspace:getDirectoryChildren')!(fakeEvent, '/dir', { includeMetadata: true });
    expect(r.success).toBe(true);
    const link = r.data.children.find((c: any) => c.name === 'linkdir');
    expect(link.type).toBe('directory');
    const file = r.data.children.find((c: any) => c.name === 'plain.txt');
    expect(file.mtime).toBe(2);
  });

  it('falls back to size 0 when a file stat throws', async () => {
    mockFsReaddirSync.mockReturnValue([
      { name: 'broken.txt', isDirectory: () => false, isSymbolicLink: () => false },
    ]);
    mockFsStatSync.mockImplementation(() => { throw new Error('stat failed'); });
    const r = await handlers.get('workspace:getDirectoryChildren')!(fakeEvent, '/dir');
    expect(r.success).toBe(true);
    expect(r.data.children[0].size).toBe(0);
  });

  it('tolerates a directory whose metadata stat throws', async () => {
    mockFsReaddirSync.mockReturnValue([
      { name: 'd', isDirectory: () => true, isSymbolicLink: () => false },
    ]);
    mockFsStatSync.mockImplementation(() => { throw new Error('stat failed'); });
    const r = await handlers.get('workspace:getDirectoryChildren')!(fakeEvent, '/dir', { includeMetadata: true });
    expect(r.success).toBe(true);
    expect(r.data.children[0].type).toBe('directory');
  });
});

describe('workspace IPC – file watch event callbacks', () => {
  it('forwards fileChanged and watchError to the renderer and ignores destroyed senders', async () => {
    vi.clearAllMocks();
    const events: Record<string, (payload: any) => void> = {};
    mockWatcher.on.mockImplementation((name: string, cb: (payload: any) => void) => { events[name] = cb; });
    mockWatcher.listenerCount.mockReturnValue(0);
    const handlers = registerAndCollect({ mainWindow: { id: 1 } });

    const liveSend = vi.fn();
    const liveEvent = { sender: { isDestroyed: () => false, send: liveSend } } as any;
    await handlers.get('workspace:startWatch')!(liveEvent, '/workspace');

    events.fileChanged?.([{ type: 'add' }]);
    events.watchError?.(new Error('watch failed'));
    expect(liveSend).toHaveBeenCalledWith('workspace:fileChanged', [{ type: 'add' }]);
    expect(liveSend).toHaveBeenCalledWith('workspace:watchError', expect.any(Error));

    // A destroyed sender must be skipped without throwing.
    const deadSend = vi.fn();
    // The callbacks captured above close over liveEvent; re-register with a dead sender.
    mockWatcher.listenerCount.mockReturnValue(0);
    const deadEvent = { sender: { isDestroyed: () => true, send: deadSend } } as any;
    await handlers.get('workspace:startWatch')!(deadEvent, '/workspace');
    events.fileChanged?.([{ type: 'unlink' }]);
    events.watchError?.(new Error('x'));
    expect(deadSend).not.toHaveBeenCalled();
  });
});

describe('workspace IPC – copy/move recursion paths', () => {
  let handlers: Map<string, HandlerFn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFsExistsSync.mockReturnValue(true);
    mockCollectImportConflicts.mockReturnValue([]);
    mockPlanImportTargets.mockReturnValue([]);
    handlers = registerAndCollect({ mainWindow: { id: 1 } });
  });

  it('records a missing import plan as a failure', async () => {
    mockFsExistsSync.mockReturnValue(true);
    mockFsStatSync.mockReturnValue({ isDirectory: () => false, size: 1 });
    mockCollectImportConflicts.mockReturnValue([]);
    mockPlanImportTargets.mockReturnValue([]); // no plan for the candidate
    const r = await handlers.get('workspace:copyPaths')!(fakeEvent, ['/src/file.txt'], '/dest');
    expect(r.success).toBe(true);
    expect(r.data.failCount).toBe(1);
    expect(r.data.results[0].error).toMatch(/Missing import plan/);
  });

  it('applies a prompt decision that resolves the conflict', async () => {
    mockFsExistsSync.mockReturnValue(true);
    mockFsStatSync.mockReturnValue({ isDirectory: () => false, size: 1 });
    mockCollectImportConflicts.mockReturnValue([
      { id: '0', displayName: 'file.txt', desiredPath: '/dest/file.txt', reason: 'already-exists' },
    ]);
    mockPromptImportConflictResolution.mockResolvedValue('replace');
    mockPlanImportTargets.mockReturnValue([
      { id: '0', finalPath: '/dest/file.txt', replaceExisting: true, skipped: false, renamed: false },
    ]);
    const r = await handlers.get('workspace:copyPaths')!(fakeEvent, ['/src/file.txt'], '/dest', { conflictResolution: 'prompt' });
    expect(r.success).toBe(true);
    expect(r.data.successCount).toBe(1);
  });

  it('records a per-item failure when the copy throws', async () => {
    mockFsExistsSync.mockReturnValue(true);
    mockFsStatSync.mockImplementation(() => { throw new Error('copy failed'); });
    mockCollectImportConflicts.mockReturnValue([]);
    mockPlanImportTargets.mockReturnValue([
      { id: '0', finalPath: '/dest/file.txt', replaceExisting: false, skipped: false, renamed: false },
    ]);
    const r = await handlers.get('workspace:copyPaths')!(fakeEvent, ['/src/file.txt'], '/dest');
    expect(r.success).toBe(true);
    expect(r.data.failCount).toBe(1);
  });

  it('copies a directory tree recursively on a cross-device move', async () => {
    mockFsExistsSync
      .mockReturnValueOnce(true)   // source exists
      .mockReturnValueOnce(true)   // dest dir exists
      .mockReturnValueOnce(false)  // target does not exist
      .mockReturnValue(false);
    mockFsRenameSync.mockImplementation(() => { throw new Error('cross-device'); });
    // top-level is a directory, with one nested file inside.
    let statCall = 0;
    mockFsStatSync.mockImplementation(() => {
      statCall += 1;
      if (statCall === 1) return { isDirectory: () => true };
      return { isDirectory: () => false };
    });
    mockFsReaddirSync.mockReturnValue(['nested.txt']);
    const r = await handlers.get('workspace:movePath')!(fakeEvent, '/src/dir', '/dest');
    expect(r.success).toBe(true);
    expect(mockFsCopyFileSync).toHaveBeenCalled();
  });
});
