/**
 * workspace.ts IPC handler coverage tests
 */

import * as path from 'path';

// ─── hoisted mock state ───────────────────────────────────────────────────────

const { mockHandle, mockShowOpenDialog, mockShellOpenPath, mockShellShowItemInFolder } = vi.hoisted(() => ({
  mockHandle: vi.fn(),
  mockShowOpenDialog: vi.fn(),
  mockShellOpenPath: vi.fn().mockResolvedValue(''),
  mockShellShowItemInFolder: vi.fn(),
}));

// ─── electron mock ────────────────────────────────────────────────────────────

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/mock/userData') },
  ipcMain: { handle: (...args: any[]) => mockHandle(...args) },
  shell: {
    openPath: (...args: any[]) => mockShellOpenPath(...args),
    showItemInFolder: (...args: any[]) => mockShellShowItemInFolder(...args),
  },
  dialog: {
    showOpenDialog: (...args: any[]) => mockShowOpenDialog(...args),
  },
}));

// ─── fs mock ──────────────────────────────────────────────────────────────────

const { mockFsExistsSync, mockFsStatSync, mockFsReaddirSync, mockFsMkdirSync, mockFsCopyFileSync, mockFsRenameSync, mockFsRmSync, mockFsUnlinkSync } = vi.hoisted(() => ({
  mockFsExistsSync: vi.fn().mockReturnValue(true),
  mockFsStatSync: vi.fn().mockReturnValue({ isDirectory: () => false, size: 100 }),
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

// ─── workspace watcher mock ───────────────────────────────────────────────────

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

// ─── pathUtils mock ───────────────────────────────────────────────────────────

const mockGetDefaultWorkspacePath = vi.fn().mockReturnValue('/default/workspace/path');
vi.mock('../../../lib/userDataADO/pathUtils', () => ({
  getDefaultWorkspacePath: (...args: any[]) => mockGetDefaultWorkspacePath(...args),
}));

// ─── lazy logger mock ─────────────────────────────────────────────────────────

const mockLogger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
vi.mock('../lazy', () => ({
  getAdvancedLogger: () => mockLogger,
}));

// ─── shared mock ──────────────────────────────────────────────────────────────

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

// ─── helpers ──────────────────────────────────────────────────────────────────

import registerWorkspace from '../workspace';

type HandlerFn = (event: any, ...args: any[]) => Promise<any>;

function buildCtx(overrides: Record<string, any> = {}): any {
  return {
    mainWindow: { id: 1 } as any,
    currentUserAlias: 'testuser',
    ...overrides,
  };
}

function registerAndCollect(ctx: any): Map<string, HandlerFn> {
  const handlers = new Map<string, HandlerFn>();
  mockHandle.mockImplementation((channel: string, fn: HandlerFn) => {
    handlers.set(channel, fn);
  });
  registerWorkspace(ctx);
  return handlers;
}

const fakeEvent = {
  sender: { isDestroyed: () => false, send: vi.fn() },
} as any;

// ─── tests ────────────────────────────────────────────────────────────────────

describe('workspace IPC handlers', () => {
  let handlers: Map<string, HandlerFn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFsExistsSync.mockReturnValue(true);
    mockFsStatSync.mockReturnValue({ isDirectory: () => false, size: 100 });
    mockFsReaddirSync.mockReturnValue([]);
    mockWatcher.listenerCount.mockReturnValue(0);
    handlers = registerAndCollect(buildCtx());
  });

  // ── workspace:selectFolder ─────────────────────────────────────────────────

  describe('workspace:selectFolder', () => {
    it('returns error when no main window', async () => {
      const h = registerAndCollect(buildCtx({ mainWindow: null }));
      const result = await h.get('workspace:selectFolder')!(fakeEvent);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/No main window/);
    });

    it('handles new API format — canceled', async () => {
      mockShowOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
      const result = await handlers.get('workspace:selectFolder')!(fakeEvent);
      expect(result.success).toBe(false);
    });

    it('handles new API format — selected', async () => {
      mockShowOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/some/folder'] });
      const result = await handlers.get('workspace:selectFolder')!(fakeEvent);
      expect(result.success).toBe(true);
      expect(result.folderPath).toBe('/some/folder');
    });

    it('handles old API format — empty array', async () => {
      mockShowOpenDialog.mockResolvedValue([]);
      const result = await handlers.get('workspace:selectFolder')!(fakeEvent);
      expect(result.success).toBe(false);
    });

    it('handles old API format — with path', async () => {
      mockShowOpenDialog.mockResolvedValue(['/old/folder']);
      const result = await handlers.get('workspace:selectFolder')!(fakeEvent);
      expect(result.success).toBe(true);
      expect(result.folderPath).toBe('/old/folder');
    });

    it('returns error on exception', async () => {
      mockShowOpenDialog.mockRejectedValue(new Error('dialog error'));
      const result = await handlers.get('workspace:selectFolder')!(fakeEvent);
      expect(result.success).toBe(false);
      expect(result.error).toBe('dialog error');
    });
  });

  // ── workspace:getFileTree ──────────────────────────────────────────────────

  describe('workspace:getFileTree', () => {
    it('returns error for invalid path', async () => {
      mockFsExistsSync.mockReturnValue(false);
      const result = await handlers.get('workspace:getFileTree')!(fakeEvent, '/bad/path');
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Invalid workspace path/);
    });

    it('returns tree on success', async () => {
      mockFsExistsSync.mockReturnValue(true);
      mockWatcher.getFileTree.mockResolvedValue({ root: { children: [] } });
      const result = await handlers.get('workspace:getFileTree')!(fakeEvent, '/workspace', {});
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });

    it('converts nodes with absolute paths', async () => {
      mockFsExistsSync.mockReturnValue(true);
      mockFsStatSync.mockReturnValue({ isDirectory: () => false, size: 42 });
      mockWatcher.getFileTree.mockResolvedValue({
        root: {
          children: [
            { name: 'file.txt', path: '/workspace/file.txt', isDirectory: false, children: [] },
          ],
        },
      });
      const result = await handlers.get('workspace:getFileTree')!(fakeEvent, '/workspace');
      expect(result.success).toBe(true);
      expect(result.data.tree).toHaveLength(1);
    });

    it('converts directory nodes', async () => {
      mockFsExistsSync.mockReturnValue(true);
      mockWatcher.getFileTree.mockResolvedValue({
        root: {
          children: [
            {
              name: 'subdir',
              path: '/workspace/subdir',
              isDirectory: true,
              children: [
                { name: 'nested.txt', path: '/workspace/subdir/nested.txt', isDirectory: false, children: [] },
              ],
            },
          ],
        },
      });
      const result = await handlers.get('workspace:getFileTree')!(fakeEvent, '/workspace');
      expect(result.success).toBe(true);
      expect(result.data.tree[0].type).toBe('directory');
    });

    it('filters out nodes outside workspace', async () => {
      mockFsExistsSync.mockReturnValue(true);
      mockWatcher.getFileTree.mockResolvedValue({
        root: {
          children: [
            { name: 'escape.txt', path: '/other/escape.txt', isDirectory: false, children: [] },
          ],
        },
      });
      const result = await handlers.get('workspace:getFileTree')!(fakeEvent, '/workspace');
      expect(result.success).toBe(true);
      expect(result.data.tree).toHaveLength(0);
    });

    it('returns error on exception', async () => {
      mockFsExistsSync.mockReturnValue(true);
      mockWatcher.getFileTree.mockRejectedValue(new Error('watcher error'));
      const result = await handlers.get('workspace:getFileTree')!(fakeEvent, '/workspace');
      expect(result.success).toBe(false);
    });
  });

  // ── workspace:clearFileTreeCache ───────────────────────────────────────────

  describe('workspace:clearFileTreeCache', () => {
    it('clears cache without path', async () => {
      const result = await handlers.get('workspace:clearFileTreeCache')!(fakeEvent);
      expect(result.success).toBe(true);
      expect(mockWatcher.clearFileTreeCache).toHaveBeenCalled();
    });

    it('clears cache for specific path', async () => {
      const result = await handlers.get('workspace:clearFileTreeCache')!(fakeEvent, '/workspace');
      expect(result.success).toBe(true);
      expect(mockWatcher.clearFileTreeCache).toHaveBeenCalledWith('/workspace');
    });

    it('returns error on exception', async () => {
      mockWatcher.clearFileTreeCache.mockImplementation(() => { throw new Error('clear error'); });
      const result = await handlers.get('workspace:clearFileTreeCache')!(fakeEvent);
      expect(result.success).toBe(false);
    });
  });

  // ── workspace:getDirectoryChildren ────────────────────────────────────────

  describe('workspace:getDirectoryChildren', () => {
    it('returns error for invalid path', async () => {
      mockFsExistsSync.mockReturnValue(false);
      const result = await handlers.get('workspace:getDirectoryChildren')!(fakeEvent, '/bad');
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Invalid directory path/);
    });

    it('returns sorted children', async () => {
      mockFsExistsSync.mockReturnValue(true);
      mockFsReaddirSync.mockReturnValue([
        { name: 'b.txt', isDirectory: () => false, isSymbolicLink: () => false },
        { name: 'a', isDirectory: () => true, isSymbolicLink: () => false },
      ]);
      mockFsStatSync.mockReturnValue({ isDirectory: () => false, size: 10 });
      const result = await handlers.get('workspace:getDirectoryChildren')!(fakeEvent, '/dir');
      expect(result.success).toBe(true);
      expect(result.data.children[0].type).toBe('directory');
      expect(result.data.children[0].name).toBe('a');
    });

    it('skips ignored patterns', async () => {
      mockFsExistsSync.mockReturnValue(true);
      mockFsReaddirSync.mockReturnValue([
        { name: 'node_modules', isDirectory: () => true, isSymbolicLink: () => false },
        { name: 'app.ts', isDirectory: () => false, isSymbolicLink: () => false },
      ]);
      mockFsStatSync.mockReturnValue({ size: 5 });
      const result = await handlers.get('workspace:getDirectoryChildren')!(fakeEvent, '/dir');
      expect(result.success).toBe(true);
      expect(result.data.children).toHaveLength(1);
      expect(result.data.children[0].name).toBe('app.ts');
    });

    it('respects custom ignorePatterns', async () => {
      mockFsExistsSync.mockReturnValue(true);
      mockFsReaddirSync.mockReturnValue([
        { name: 'custom_ignore', isDirectory: () => false, isSymbolicLink: () => false },
        { name: 'keep.ts', isDirectory: () => false, isSymbolicLink: () => false },
      ]);
      mockFsStatSync.mockReturnValue({ size: 5 });
      const result = await handlers.get('workspace:getDirectoryChildren')!(fakeEvent, '/dir', { ignorePatterns: ['custom_ignore'] });
      expect(result.data.children).toHaveLength(1);
    });

    it('returns error on exception', async () => {
      mockFsExistsSync.mockReturnValue(true);
      mockFsReaddirSync.mockImplementation(() => { throw new Error('read error'); });
      const result = await handlers.get('workspace:getDirectoryChildren')!(fakeEvent, '/dir');
      expect(result.success).toBe(false);
    });
  });

  // ── workspace:startWatch ───────────────────────────────────────────────────

  describe('workspace:startWatch', () => {
    it('starts watching', async () => {
      const result = await handlers.get('workspace:startWatch')!(fakeEvent, '/workspace');
      expect(result.success).toBe(true);
      expect(mockWatcher.startFileWatch).toHaveBeenCalledWith('/workspace', undefined);
    });

    it('does not add duplicate listeners', async () => {
      mockWatcher.listenerCount.mockReturnValue(1);
      await handlers.get('workspace:startWatch')!(fakeEvent, '/workspace');
      expect(mockWatcher.on).not.toHaveBeenCalled();
    });

    it('adds listeners when none registered', async () => {
      mockWatcher.listenerCount.mockReturnValue(0);
      await handlers.get('workspace:startWatch')!(fakeEvent, '/workspace');
      expect(mockWatcher.on).toHaveBeenCalled();
    });

    it('returns error on exception', async () => {
      mockWatcher.startFileWatch.mockRejectedValue(new Error('start error'));
      const result = await handlers.get('workspace:startWatch')!(fakeEvent, '/workspace');
      expect(result.success).toBe(false);
    });
  });

  // ── workspace:stopWatch ────────────────────────────────────────────────────

  describe('workspace:stopWatch', () => {
    it('stops watching', async () => {
      const result = await handlers.get('workspace:stopWatch')!(fakeEvent);
      expect(result.success).toBe(true);
    });

    it('returns error on exception', async () => {
      mockWatcher.stopFileWatch.mockRejectedValue(new Error('stop error'));
      const result = await handlers.get('workspace:stopWatch')!(fakeEvent);
      expect(result.success).toBe(false);
    });
  });

  // ── workspace:getWatcherStats ──────────────────────────────────────────────

  describe('workspace:getWatcherStats', () => {
    it('returns stats', async () => {
      const result = await handlers.get('workspace:getWatcherStats')!(fakeEvent);
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ watching: true });
    });

    it('returns error on exception', async () => {
      mockWatcher.getWatcherStats.mockImplementation(() => { throw new Error('stats error'); });
      const result = await handlers.get('workspace:getWatcherStats')!(fakeEvent);
      expect(result.success).toBe(false);
    });
  });

  // ── workspace:searchFiles ──────────────────────────────────────────────────

  describe('workspace:searchFiles', () => {
    it('returns error when folder is missing', async () => {
      const result = await handlers.get('workspace:searchFiles')!(fakeEvent, { pattern: 'test' });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/required/);
    });

    it('returns search results', async () => {
      mockWatcher.searchFiles.mockResolvedValue({ results: ['file.ts'] });
      const result = await handlers.get('workspace:searchFiles')!(fakeEvent, { folder: '/workspace', pattern: 'test' });
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });

    it('returns error on exception', async () => {
      mockWatcher.searchFiles.mockRejectedValue(new Error('search error'));
      const result = await handlers.get('workspace:searchFiles')!(fakeEvent, { folder: '/workspace' });
      expect(result.success).toBe(false);
    });
  });

  // ── workspace:copyPaths ────────────────────────────────────────────────────

  describe('workspace:copyPaths', () => {
    beforeEach(() => {
      mockCollectImportConflicts.mockReturnValue([]);
      mockPlanImportTargets.mockReturnValue([]);
    });

    it('skips missing source paths', async () => {
      mockFsExistsSync.mockReturnValue(false);
      const result = await handlers.get('workspace:copyPaths')!(fakeEvent, ['/missing/file.txt'], '/dest');
      expect(result.success).toBe(true);
      expect(result.data.failCount).toBe(1);
    });

    it('copies file successfully', async () => {
      mockFsExistsSync.mockReturnValue(true);
      mockFsStatSync.mockReturnValue({ isDirectory: () => false, size: 10 });
      mockCollectImportConflicts.mockReturnValue([]);
      mockPlanImportTargets.mockReturnValue([
        { id: '0', finalPath: '/dest/file.txt', replaceExisting: false, skipped: false, renamed: false },
      ]);
      const result = await handlers.get('workspace:copyPaths')!(fakeEvent, ['/src/file.txt'], '/dest');
      expect(result.success).toBe(true);
      expect(result.data.successCount).toBe(1);
    });

    it('skips item when plan.skipped is true', async () => {
      mockFsExistsSync.mockReturnValue(true);
      mockCollectImportConflicts.mockReturnValue([]);
      mockPlanImportTargets.mockReturnValue([
        { id: '0', skipped: true },
      ]);
      const result = await handlers.get('workspace:copyPaths')!(fakeEvent, ['/src/file.txt'], '/dest');
      expect(result.success).toBe(true);
      expect(result.data.skippedCount).toBe(1);
    });

    it('handles reject strategy with conflicts', async () => {
      mockFsExistsSync.mockReturnValue(true);
      mockCollectImportConflicts.mockReturnValue([
        { id: '0', displayName: 'file.txt', desiredPath: '/dest/file.txt', reason: 'already-exists' },
      ]);
      const result = await handlers.get('workspace:copyPaths')!(fakeEvent, ['/src/file.txt'], '/dest', { conflictResolution: 'reject' });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/already exists/);
    });

    it('handles prompt strategy — cancel', async () => {
      mockFsExistsSync.mockReturnValue(true);
      mockCollectImportConflicts.mockReturnValue([
        { id: '0', displayName: 'file.txt', desiredPath: '/dest/file.txt', reason: 'already-exists' },
      ]);
      mockPromptImportConflictResolution.mockResolvedValue('cancel');
      const result = await handlers.get('workspace:copyPaths')!(fakeEvent, ['/src/file.txt'], '/dest', { conflictResolution: 'prompt' });
      expect(result.success).toBe(false);
      expect(result.canceled).toBe(true);
    });

    it('handles replace strategy with existing target', async () => {
      mockFsExistsSync.mockReturnValue(true);
      mockFsStatSync.mockReturnValue({ isDirectory: () => false, size: 10 });
      mockCollectImportConflicts.mockReturnValue([]);
      mockPlanImportTargets.mockReturnValue([
        { id: '0', finalPath: '/dest/file.txt', replaceExisting: true, skipped: false, renamed: false },
      ]);
      const result = await handlers.get('workspace:copyPaths')!(fakeEvent, ['/src/file.txt'], '/dest', { conflictResolution: 'replace' });
      expect(result.success).toBe(true);
      expect(mockFsRmSync).toHaveBeenCalled();
    });
  });

  // ── workspace:copyPath ─────────────────────────────────────────────────────

  describe('workspace:copyPath', () => {
    it('delegates to copyPaths', async () => {
      mockFsExistsSync.mockReturnValue(false);
      const result = await handlers.get('workspace:copyPath')!(fakeEvent, '/missing.txt', '/dest');
      expect(result).toBeDefined();
    });
  });

  // ── workspace:movePath ─────────────────────────────────────────────────────

  describe('workspace:movePath', () => {
    it('returns error when source does not exist', async () => {
      mockFsExistsSync.mockReturnValue(false);
      const result = await handlers.get('workspace:movePath')!(fakeEvent, '/missing', '/dest');
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Source path does not exist/);
    });

    it('creates dest dir if missing and renames', async () => {
      mockFsExistsSync
        .mockReturnValueOnce(true)   // source exists
        .mockReturnValueOnce(false)  // dest dir does not exist
        .mockReturnValueOnce(false); // target path does not exist
      const result = await handlers.get('workspace:movePath')!(fakeEvent, '/src/file.txt', '/dest');
      expect(result.success).toBe(true);
      expect(mockFsMkdirSync).toHaveBeenCalled();
      expect(mockFsRenameSync).toHaveBeenCalled();
    });

    it('returns TARGET_EXISTS when no force', async () => {
      mockFsExistsSync.mockReturnValue(true);
      const result = await handlers.get('workspace:movePath')!(fakeEvent, '/src/file.txt', '/dest');
      expect(result.success).toBe(false);
      expect(result.error).toBe('TARGET_EXISTS');
    });

    it('force replaces existing target', async () => {
      mockFsExistsSync.mockReturnValue(true);
      const result = await handlers.get('workspace:movePath')!(fakeEvent, '/src/file.txt', '/dest', { force: true });
      expect(result.success).toBe(true);
      expect(mockFsRmSync).toHaveBeenCalled();
    });

    it('falls back to copy+delete when rename fails (file)', async () => {
      mockFsExistsSync
        .mockReturnValueOnce(true)   // source exists
        .mockReturnValueOnce(true)   // dest dir exists
        .mockReturnValueOnce(false); // target does not exist
      mockFsRenameSync.mockImplementation(() => { throw new Error('cross-device'); });
      mockFsStatSync.mockReturnValue({ isDirectory: () => false });
      const result = await handlers.get('workspace:movePath')!(fakeEvent, '/src/file.txt', '/dest');
      expect(result.success).toBe(true);
      expect(mockFsCopyFileSync).toHaveBeenCalled();
      expect(mockFsUnlinkSync).toHaveBeenCalled();
    });

    it('falls back to copy+delete when rename fails (directory)', async () => {
      mockFsExistsSync
        .mockReturnValueOnce(true)   // source exists
        .mockReturnValueOnce(true)   // dest dir exists
        .mockReturnValueOnce(false)  // target does not exist
        .mockReturnValue(false);
      mockFsRenameSync.mockImplementation(() => { throw new Error('cross-device'); });
      mockFsStatSync.mockReturnValue({ isDirectory: () => true });
      mockFsReaddirSync.mockReturnValue([]);
      const result = await handlers.get('workspace:movePath')!(fakeEvent, '/src/dir', '/dest');
      expect(result.success).toBe(true);
      expect(mockFsMkdirSync).toHaveBeenCalled();
      expect(mockFsRmSync).toHaveBeenCalled();
    });

    it('returns error on exception', async () => {
      mockFsExistsSync.mockReturnValue(true);
      mockFsRmSync.mockImplementation(() => { throw new Error('rm error'); });
      const result = await handlers.get('workspace:movePath')!(fakeEvent, '/src/file.txt', '/dest', { force: true });
      expect(result.success).toBe(false);
    });
  });

  // ── workspace:openPath ─────────────────────────────────────────────────────

  describe('workspace:openPath', () => {
    it('returns error when path does not exist', async () => {
      mockFsExistsSync.mockReturnValue(false);
      const result = await handlers.get('workspace:openPath')!(fakeEvent, '/missing');
      expect(result.success).toBe(false);
    });

    it('returns success when shell.openPath succeeds', async () => {
      mockFsExistsSync.mockReturnValue(true);
      mockShellOpenPath.mockResolvedValue('');
      const result = await handlers.get('workspace:openPath')!(fakeEvent, '/file.txt');
      expect(result.success).toBe(true);
    });

    it('returns error when shell.openPath returns error string', async () => {
      mockFsExistsSync.mockReturnValue(true);
      mockShellOpenPath.mockResolvedValue('cannot open');
      const result = await handlers.get('workspace:openPath')!(fakeEvent, '/file.txt');
      expect(result.success).toBe(false);
      expect(result.error).toBe('cannot open');
    });

    it('returns error on exception', async () => {
      mockFsExistsSync.mockReturnValue(true);
      mockShellOpenPath.mockRejectedValue(new Error('open error'));
      const result = await handlers.get('workspace:openPath')!(fakeEvent, '/file.txt');
      expect(result.success).toBe(false);
    });
  });

  // ── workspace:showInFolder ─────────────────────────────────────────────────

  describe('workspace:showInFolder', () => {
    it('returns error when path does not exist', async () => {
      mockFsExistsSync.mockReturnValue(false);
      const result = await handlers.get('workspace:showInFolder')!(fakeEvent, '/missing');
      expect(result.success).toBe(false);
    });

    it('shows item in folder', async () => {
      mockFsExistsSync.mockReturnValue(true);
      const result = await handlers.get('workspace:showInFolder')!(fakeEvent, '/file.txt');
      expect(result.success).toBe(true);
      expect(mockShellShowItemInFolder).toHaveBeenCalledWith('/file.txt');
    });

    it('returns error on exception', async () => {
      mockFsExistsSync.mockReturnValue(true);
      mockShellShowItemInFolder.mockImplementation(() => { throw new Error('show error'); });
      const result = await handlers.get('workspace:showInFolder')!(fakeEvent, '/file.txt');
      expect(result.success).toBe(false);
    });
  });

  // ── workspace:getDefaultWorkspacePath ─────────────────────────────────────

  describe('workspace:getDefaultWorkspacePath', () => {
    it('returns error when alias or chatId missing', async () => {
      const result = await handlers.get('workspace:getDefaultWorkspacePath')!(fakeEvent, '', 'chat1');
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/required/);
    });

    it('returns default path', async () => {
      mockGetDefaultWorkspacePath.mockReturnValue('/default/path');
      const result = await handlers.get('workspace:getDefaultWorkspacePath')!(fakeEvent, 'user', 'chat1');
      expect(result.success).toBe(true);
      expect(result.data).toBe('/default/path');
    });

    it('returns error on exception', async () => {
      mockGetDefaultWorkspacePath.mockImplementation(() => { throw new Error('path error'); });
      const result = await handlers.get('workspace:getDefaultWorkspacePath')!(fakeEvent, 'user', 'chat1');
      expect(result.success).toBe(false);
    });
  });
});
