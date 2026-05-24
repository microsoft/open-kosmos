// @ts-nocheck
/** @vitest-environment happy-dom */
/**
 * Additional coverage tests for workspaceOps — all methods not covered by
 * the existing workspaceOps.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Setup window.electronAPI before module import ─────────────────────────────

const mockSelectFolder = vi.fn();
const mockGetFileTree = vi.fn();
const mockCopyPath = vi.fn();
const mockCopyPaths = vi.fn();
const mockShowInFolder = vi.fn();
const mockGetDirectoryChildren = vi.fn();
const mockClearFileTreeCache = vi.fn();
const mockStartWatch = vi.fn();
const mockStopWatch = vi.fn();
const mockGetWatcherStats = vi.fn();
const mockOnFileChanged = vi.fn(() => vi.fn());
const mockOnWatchError = vi.fn(() => vi.fn());

Object.defineProperty(window, 'electronAPI', {
  value: {
    workspace: {
      selectFolder: mockSelectFolder,
      getFileTree: mockGetFileTree,
      copyPath: mockCopyPath,
      copyPaths: mockCopyPaths,
      showInFolder: mockShowInFolder,
      getDirectoryChildren: mockGetDirectoryChildren,
      clearFileTreeCache: mockClearFileTreeCache,
      startWatch: mockStartWatch,
      stopWatch: mockStopWatch,
      getWatcherStats: mockGetWatcherStats,
      onFileChanged: mockOnFileChanged,
      onWatchError: mockOnWatchError,
    },
  },
  writable: true,
  configurable: true,
});

// Mock chatOps before importing workspaceOps
const mockUpdateChatAgent = vi.fn();
vi.mock('../chatOps', () => ({
  updateChatAgent: (...args: unknown[]) => mockUpdateChatAgent(...args),
}));

import {
  WorkspaceOpsManager,
  getWorkspaceFileTree,
  getDirectoryChildren,
  clearFileTreeCache,
  updateChatWorkspace,
  updateChatKnowledgeBase,
  startWatch,
  stopWatch,
  getWatcherStats,
  copyPathToWorkspace,
  copyPathsToWorkspace,
  openInSystemExplorer,
  triggerRefresh,
  onRefresh,
  onError,
} from '../workspaceOps';

// ── Helpers ───────────────────────────────────────────────────────────────────

function freshManager(): WorkspaceOpsManager {
  (WorkspaceOpsManager as any).instance = null;
  return WorkspaceOpsManager.getInstance();
}

// ── getWorkspaceFileTree ───────────────────────────────────────────────────────

describe('getWorkspaceFileTree', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns error when API unavailable', async () => {
    (window as any).electronAPI.workspace.selectFolder = undefined;
    (window as any).electronAPI.workspace.getFileTree = undefined;
    const result = await getWorkspaceFileTree('/some/path');
    expect(result.success).toBe(false);
    // Restore
    (window as any).electronAPI.workspace.selectFolder = mockSelectFolder;
    (window as any).electronAPI.workspace.getFileTree = mockGetFileTree;
  });

  it('returns error for empty workspace path', async () => {
    const result = await getWorkspaceFileTree('');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Invalid workspace path/);
  });

  it('returns error for whitespace-only path', async () => {
    const result = await getWorkspaceFileTree('   ');
    expect(result.success).toBe(false);
  });

  it('returns success with tree data', async () => {
    mockGetFileTree.mockResolvedValue({
      success: true,
      data: { workspacePath: '/some/path', workspaceName: 'path', tree: [] },
    });
    const result = await getWorkspaceFileTree('/some/path');
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
  });

  it('returns error when IPC call fails', async () => {
    mockGetFileTree.mockResolvedValue({ success: false, error: 'path not found' });
    const result = await getWorkspaceFileTree('/bad/path');
    expect(result.success).toBe(false);
    expect(result.error).toBe('path not found');
  });

  it('returns error on thrown exception', async () => {
    mockGetFileTree.mockRejectedValue(new Error('IPC error'));
    const result = await getWorkspaceFileTree('/some/path');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/IPC error/);
  });
});

// ── getDirectoryChildren ──────────────────────────────────────────────────────

describe('getDirectoryChildren', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns error when API unavailable', async () => {
    (window as any).electronAPI.workspace.getFileTree = undefined;
    const result = await getDirectoryChildren('/some/dir');
    expect(result.success).toBe(false);
    (window as any).electronAPI.workspace.getFileTree = mockGetFileTree;
  });

  it('returns error for empty path', async () => {
    const result = await getDirectoryChildren('');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Invalid directory path/);
  });

  it('returns success with children data', async () => {
    mockGetDirectoryChildren.mockResolvedValue({ success: true, data: [] });
    const result = await getDirectoryChildren('/some/dir');
    expect(result.success).toBe(true);
  });

  it('returns error when IPC fails', async () => {
    mockGetDirectoryChildren.mockResolvedValue({ success: false, error: 'denied' });
    const result = await getDirectoryChildren('/some/dir');
    expect(result.success).toBe(false);
    expect(result.error).toBe('denied');
  });

  it('handles thrown exceptions', async () => {
    mockGetDirectoryChildren.mockRejectedValue(new Error('crash'));
    const result = await getDirectoryChildren('/some/dir');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/crash/);
  });
});

// ── clearFileTreeCache ────────────────────────────────────────────────────────

describe('clearFileTreeCache', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns error when API unavailable', async () => {
    (window as any).electronAPI.workspace.selectFolder = undefined;
    (window as any).electronAPI.workspace.getFileTree = undefined;
    const result = await clearFileTreeCache('/path');
    expect(result.success).toBe(false);
    (window as any).electronAPI.workspace.selectFolder = mockSelectFolder;
    (window as any).electronAPI.workspace.getFileTree = mockGetFileTree;
  });

  it('returns success', async () => {
    mockClearFileTreeCache.mockResolvedValue({ success: true });
    const result = await clearFileTreeCache('/path');
    expect(result.success).toBe(true);
  });

  it('works without a path argument', async () => {
    mockClearFileTreeCache.mockResolvedValue({ success: true });
    const result = await clearFileTreeCache();
    expect(result.success).toBe(true);
  });

  it('returns error when IPC fails', async () => {
    mockClearFileTreeCache.mockResolvedValue({ success: false, error: 'cache error' });
    const result = await clearFileTreeCache();
    expect(result.success).toBe(false);
  });

  it('handles thrown exceptions', async () => {
    mockClearFileTreeCache.mockRejectedValue(new Error('crash'));
    const result = await clearFileTreeCache();
    expect(result.success).toBe(false);
  });
});

// ── updateChatWorkspace ───────────────────────────────────────────────────────

describe('updateChatWorkspace', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns success when updateChatAgent succeeds', async () => {
    mockUpdateChatAgent.mockResolvedValue({ success: true });
    const result = await updateChatWorkspace('chat-123', '/my/workspace');
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ chatId: 'chat-123', workspacePath: '/my/workspace' });
  });

  it('returns error when updateChatAgent fails', async () => {
    mockUpdateChatAgent.mockResolvedValue({ success: false, error: 'not found' });
    const result = await updateChatWorkspace('chat-123', '/my/workspace');
    expect(result.success).toBe(false);
    expect(result.error).toBe('not found');
  });

  it('handles thrown exceptions', async () => {
    mockUpdateChatAgent.mockRejectedValue(new Error('crash'));
    const result = await updateChatWorkspace('chat-123', '/my/workspace');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/crash/);
  });
});

// ── updateChatKnowledgeBase ───────────────────────────────────────────────────

describe('updateChatKnowledgeBase', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns success when updateChatAgent succeeds', async () => {
    mockUpdateChatAgent.mockResolvedValue({ success: true });
    const result = await updateChatKnowledgeBase('chat-123', '/my/kb');
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ chatId: 'chat-123', knowledgeBasePath: '/my/kb' });
  });

  it('returns error when updateChatAgent fails', async () => {
    mockUpdateChatAgent.mockResolvedValue({ success: false, error: 'error' });
    const result = await updateChatKnowledgeBase('chat-123', '/my/kb');
    expect(result.success).toBe(false);
  });

  it('handles thrown exceptions', async () => {
    mockUpdateChatAgent.mockRejectedValue(new Error('crash'));
    const result = await updateChatKnowledgeBase('chat-123', '/my/kb');
    expect(result.success).toBe(false);
  });
});

// ── startWatch / stopWatch ────────────────────────────────────────────────────

describe('startWatch', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns error when API unavailable', async () => {
    (window as any).electronAPI.workspace.selectFolder = undefined;
    (window as any).electronAPI.workspace.getFileTree = undefined;
    const result = await startWatch('/path');
    expect(result.success).toBe(false);
    (window as any).electronAPI.workspace.selectFolder = mockSelectFolder;
    (window as any).electronAPI.workspace.getFileTree = mockGetFileTree;
  });

  it('returns error for empty path', async () => {
    const result = await startWatch('');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Invalid workspace path/);
  });

  it('returns success and sets watch state', async () => {
    mockStartWatch.mockResolvedValue({ success: true });
    const mgr = freshManager();
    const result = await mgr.startWatch('/some/path');
    expect(result.success).toBe(true);
    expect(mgr.getWatchStatus().isWatching).toBe(true);
    expect(mgr.getWatchStatus().currentPath).toBe('/some/path');
  });

  it('skips if already watching the same path', async () => {
    mockStartWatch.mockResolvedValue({ success: true });
    const mgr = freshManager();
    await mgr.startWatch('/some/path');
    mockStartWatch.mockClear();
    const result = await mgr.startWatch('/some/path');
    expect(result.success).toBe(true);
    expect(mockStartWatch).not.toHaveBeenCalled(); // skipped
  });

  it('stops old watch and starts new one when path differs', async () => {
    mockStartWatch.mockResolvedValue({ success: true });
    mockStopWatch.mockResolvedValue({ success: true });
    const mgr = freshManager();
    await mgr.startWatch('/path-a');
    await mgr.startWatch('/path-b');
    expect(mockStopWatch).toHaveBeenCalled();
    expect(mgr.getWatchStatus().currentPath).toBe('/path-b');
  });

  it('returns error when IPC startWatch fails', async () => {
    mockStartWatch.mockResolvedValue({ success: false, error: 'watch error' });
    const result = await startWatch('/some/path');
    expect(result.success).toBe(false);
  });

  it('handles thrown exceptions', async () => {
    mockStartWatch.mockRejectedValue(new Error('crash'));
    const result = await startWatch('/some/path');
    expect(result.success).toBe(false);
  });
});

describe('stopWatch', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns success immediately if not watching', async () => {
    const mgr = freshManager();
    const result = await mgr.stopWatch();
    expect(result.success).toBe(true);
    expect(mockStopWatch).not.toHaveBeenCalled();
  });

  it('stops watching and clears state', async () => {
    mockStartWatch.mockResolvedValue({ success: true });
    mockStopWatch.mockResolvedValue({ success: true });
    const mgr = freshManager();
    await mgr.startWatch('/some/path');
    const result = await mgr.stopWatch();
    expect(result.success).toBe(true);
    expect(mgr.getWatchStatus().isWatching).toBe(false);
    expect(mgr.getWatchStatus().currentPath).toBeNull();
  });

  it('returns error when IPC stopWatch fails', async () => {
    mockStartWatch.mockResolvedValue({ success: true });
    mockStopWatch.mockResolvedValue({ success: false, error: 'stop error' });
    const mgr = freshManager();
    await mgr.startWatch('/some/path');
    const result = await mgr.stopWatch();
    expect(result.success).toBe(false);
  });

  it('handles thrown exception', async () => {
    mockStartWatch.mockResolvedValue({ success: true });
    mockStopWatch.mockRejectedValue(new Error('crash'));
    const mgr = freshManager();
    await mgr.startWatch('/some/path');
    const result = await mgr.stopWatch();
    expect(result.success).toBe(false);
  });
});

// ── getWatcherStats ────────────────────────────────────────────────────────────

describe('getWatcherStats', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns error when API unavailable', async () => {
    (window as any).electronAPI.workspace.selectFolder = undefined;
    (window as any).electronAPI.workspace.getFileTree = undefined;
    const result = await getWatcherStats();
    expect(result.success).toBe(false);
    (window as any).electronAPI.workspace.selectFolder = mockSelectFolder;
    (window as any).electronAPI.workspace.getFileTree = mockGetFileTree;
  });

  it('returns stats data on success', async () => {
    mockGetWatcherStats.mockResolvedValue({ success: true, data: { files: 10 } });
    const result = await getWatcherStats();
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ files: 10 });
  });

  it('returns error when IPC fails', async () => {
    mockGetWatcherStats.mockResolvedValue({ success: false, error: 'stats error' });
    const result = await getWatcherStats();
    expect(result.success).toBe(false);
  });

  it('handles thrown exceptions', async () => {
    mockGetWatcherStats.mockRejectedValue(new Error('crash'));
    const result = await getWatcherStats();
    expect(result.success).toBe(false);
  });
});

// ── copyPathToWorkspace ───────────────────────────────────────────────────────

describe('copyPathToWorkspace', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns error when API unavailable', async () => {
    (window as any).electronAPI.workspace.selectFolder = undefined;
    (window as any).electronAPI.workspace.getFileTree = undefined;
    const result = await copyPathToWorkspace('/src', '/dst');
    expect(result.success).toBe(false);
    (window as any).electronAPI.workspace.selectFolder = mockSelectFolder;
    (window as any).electronAPI.workspace.getFileTree = mockGetFileTree;
  });

  it('returns error when sourcePath is empty', async () => {
    const result = await copyPathToWorkspace('', '/dst');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Invalid source or destination/);
  });

  it('returns error when destPath is empty', async () => {
    const result = await copyPathToWorkspace('/src', '');
    expect(result.success).toBe(false);
  });

  it('returns success with data', async () => {
    mockCopyPath.mockResolvedValue({ success: true, data: { copied: 1 } });
    const result = await copyPathToWorkspace('/src', '/dst');
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
  });

  it('returns error when IPC fails', async () => {
    mockCopyPath.mockResolvedValue({ success: false, error: 'copy error' });
    const result = await copyPathToWorkspace('/src', '/dst');
    expect(result.success).toBe(false);
  });

  it('handles thrown exceptions', async () => {
    mockCopyPath.mockRejectedValue(new Error('crash'));
    const result = await copyPathToWorkspace('/src', '/dst');
    expect(result.success).toBe(false);
  });
});

// ── copyPathsToWorkspace ──────────────────────────────────────────────────────

describe('copyPathsToWorkspace', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns error when API unavailable', async () => {
    (window as any).electronAPI.workspace.selectFolder = undefined;
    (window as any).electronAPI.workspace.getFileTree = undefined;
    const result = await copyPathsToWorkspace(['/src'], '/dst');
    expect(result.success).toBe(false);
    (window as any).electronAPI.workspace.selectFolder = mockSelectFolder;
    (window as any).electronAPI.workspace.getFileTree = mockGetFileTree;
  });

  it('returns error when sourcePaths is empty', async () => {
    const result = await copyPathsToWorkspace([], '/dst');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Invalid source or destination/);
  });

  it('returns error when destPath is empty', async () => {
    const result = await copyPathsToWorkspace(['/src'], '');
    expect(result.success).toBe(false);
  });

  it('returns success with data', async () => {
    mockCopyPaths.mockResolvedValue({ success: true, data: { copied: 2 } });
    const result = await copyPathsToWorkspace(['/src1', '/src2'], '/dst');
    expect(result.success).toBe(true);
  });

  it('returns error with canceled flag when IPC returns canceled', async () => {
    mockCopyPaths.mockResolvedValue({ success: false, error: 'conflict', canceled: true, data: null });
    const result = await copyPathsToWorkspace(['/src'], '/dst');
    expect(result.success).toBe(false);
    expect(result.canceled).toBe(true);
  });

  it('handles thrown exceptions', async () => {
    mockCopyPaths.mockRejectedValue(new Error('crash'));
    const result = await copyPathsToWorkspace(['/src'], '/dst');
    expect(result.success).toBe(false);
  });
});

// ── openInSystemExplorer ──────────────────────────────────────────────────────

describe('openInSystemExplorer', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns error when API unavailable', async () => {
    (window as any).electronAPI.workspace.selectFolder = undefined;
    (window as any).electronAPI.workspace.getFileTree = undefined;
    const result = await openInSystemExplorer('/some/path');
    expect(result.success).toBe(false);
    (window as any).electronAPI.workspace.selectFolder = mockSelectFolder;
    (window as any).electronAPI.workspace.getFileTree = mockGetFileTree;
  });

  it('returns error for empty path', async () => {
    const result = await openInSystemExplorer('');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Invalid path/);
  });

  it('returns success', async () => {
    mockShowInFolder.mockResolvedValue({ success: true });
    const result = await openInSystemExplorer('/some/path');
    expect(result.success).toBe(true);
  });

  it('returns error when IPC fails', async () => {
    mockShowInFolder.mockResolvedValue({ success: false, error: 'open error' });
    const result = await openInSystemExplorer('/some/path');
    expect(result.success).toBe(false);
  });

  it('handles thrown exceptions', async () => {
    mockShowInFolder.mockRejectedValue(new Error('crash'));
    const result = await openInSystemExplorer('/some/path');
    expect(result.success).toBe(false);
  });
});

// ── onRefresh / notifyRefreshListeners / triggerRefresh ───────────────────────

describe('WorkspaceOpsManager — refresh listeners', () => {
  it('notifies refresh listeners on triggerRefresh', () => {
    const mgr = freshManager();
    const spy = vi.fn();
    const unsub = mgr.onRefresh(spy);
    mgr.triggerRefresh();
    expect(spy).toHaveBeenCalled();
    unsub();
  });

  it('removes listener when unsubscribe function is called', () => {
    const mgr = freshManager();
    const spy = vi.fn();
    const unsub = mgr.onRefresh(spy);
    unsub();
    mgr.triggerRefresh();
    expect(spy).not.toHaveBeenCalled();
  });

  it('handles listener throw gracefully', () => {
    const mgr = freshManager();
    mgr.onRefresh(() => { throw new Error('listener error'); });
    expect(() => mgr.triggerRefresh()).not.toThrow();
  });
});

// ── onError / notifyErrorListeners ────────────────────────────────────────────

describe('WorkspaceOpsManager — error listeners', () => {
  it('notifies error listeners on backend error', () => {
    // Intercept onWatchError registration
    let registeredErrorCb: ((e: any) => void) | null = null;
    mockOnWatchError.mockImplementation((cb: (e: any) => void) => {
      registeredErrorCb = cb;
      return () => {};
    });

    const mgr = freshManager();
    const spy = vi.fn();
    const unsub = mgr.onError(spy);

    // Simulate backend error
    registeredErrorCb?.({ code: 'ENOENT' });
    expect(spy).toHaveBeenCalledWith({ code: 'ENOENT' });
    unsub();
  });

  it('removes error listener when unsubscribe is called', () => {
    const mgr = freshManager();
    const spy = vi.fn();
    const unsub = mgr.onError(spy);
    unsub();
    (mgr as any).notifyErrorListeners('err');
    expect(spy).not.toHaveBeenCalled();
  });

  it('handles error listener throw gracefully', () => {
    const mgr = freshManager();
    mgr.onError(() => { throw new Error('err listener error'); });
    expect(() => (mgr as any).notifyErrorListeners('some error')).not.toThrow();
  });
});

// ── onRefresh exported convenience ───────────────────────────────────────────

describe('onRefresh exported function', () => {
  it('is callable and returns an unsubscribe function', () => {
    // onRefresh is not directly exported — use WorkspaceOpsManager
    const mgr = freshManager();
    const unsub = mgr.onRefresh(() => {});
    expect(typeof unsub).toBe('function');
    unsub();
  });
});
