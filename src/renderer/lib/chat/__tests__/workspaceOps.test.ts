// @ts-nocheck
/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock window.electronAPI before module import
const mockSelectFolder = vi.fn();
const mockGetFileTree = vi.fn();
const mockCopyPath = vi.fn();
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
});

import {
  WorkspaceOpsManager,
  getWorkspaceName,
  isValidWorkspacePath,
  FileChangeType,
  selectWorkspaceFolder,
  getWatchStatus,
  onFileChange,
  onError,
} from '../workspaceOps';

describe('FileChangeType enum', () => {
  it('UPDATED is 0', () => expect(FileChangeType.UPDATED).toBe(0));
  it('ADDED is 1', () => expect(FileChangeType.ADDED).toBe(1));
  it('DELETED is 2', () => expect(FileChangeType.DELETED).toBe(2));
});

describe('getWorkspaceName', () => {
  it('returns last path segment for Unix path', () => {
    expect(getWorkspaceName('/home/user/my-project')).toBe('my-project');
  });

  it('returns last path segment for Windows path', () => {
    expect(getWorkspaceName('C:\\Users\\user\\my-project')).toBe('my-project');
  });

  it('handles trailing slash', () => {
    expect(getWorkspaceName('/home/user/project/')).toBe('project');
  });

  it('returns "No Workspace" for empty string', () => {
    expect(getWorkspaceName('')).toBe('No Workspace');
  });

  it('returns "No Workspace" for whitespace-only string', () => {
    expect(getWorkspaceName('   ')).toBe('No Workspace');
  });

  it('returns "Workspace" for root path /', () => {
    // Root "/" after normalization gives empty last segment
    expect(getWorkspaceName('/')).toBe('Workspace');
  });

  it('handles path with multiple trailing slashes', () => {
    expect(getWorkspaceName('/home/user/project///')).toBe('project');
  });
});

describe('isValidWorkspacePath', () => {
  it('returns true for non-empty path', () => {
    expect(isValidWorkspacePath('/home/user/project')).toBe(true);
  });

  it('returns false for empty string', () => {
    expect(isValidWorkspacePath('')).toBe(false);
  });

  it('returns false for whitespace-only string', () => {
    expect(isValidWorkspacePath('   ')).toBe(false);
  });

  it('returns true for relative path', () => {
    expect(isValidWorkspacePath('./my-project')).toBe(true);
  });
});

describe('getWatchStatus', () => {
  it('returns an object with isWatching and currentPath', () => {
    const status = getWatchStatus();
    expect(status).toHaveProperty('isWatching');
    expect(status).toHaveProperty('currentPath');
  });

  it('isWatching is boolean', () => {
    const status = getWatchStatus();
    expect(typeof status.isWatching).toBe('boolean');
  });
});

describe('onFileChange', () => {
  it('returns an unsubscribe function', () => {
    const unsub = onFileChange(() => {});
    expect(typeof unsub).toBe('function');
    unsub(); // should not throw
  });

  it('listener is called when file change events are emitted', () => {
    // Capture the listener registered via onFileChanged mock
    const registeredListeners: Array<(changes: any[]) => void> = [];
    mockOnFileChanged.mockImplementation((cb: any) => {
      registeredListeners.push(cb);
      return () => {};
    });

    // Re-create a fresh manager instance for isolated test
    // Access private method via any-cast; this exercises the refresh pathway
    const mgr = WorkspaceOpsManager.getInstance();
    const spy = vi.fn();
    const unsub = mgr.onFileChange(spy);

    // Simulate a file change by calling notifyRefreshListeners via triggerRefresh
    mgr.triggerRefresh();
    expect(spy).toHaveBeenCalled();
    unsub();
  });
});

describe('onError', () => {
  it('returns an unsubscribe function', () => {
    const unsub = onError(() => {});
    expect(typeof unsub).toBe('function');
    unsub();
  });
});

describe('selectWorkspaceFolder', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns error when API is unavailable', async () => {
    // Temporarily remove API
    const saved = (window as any).electronAPI.workspace.selectFolder;
    (window as any).electronAPI.workspace.selectFolder = undefined;
    const result = await selectWorkspaceFolder();
    expect(result.success).toBe(false);
    (window as any).electronAPI.workspace.selectFolder = saved;
  });

  it('returns success with folder path', async () => {
    mockSelectFolder.mockResolvedValue({ success: true, folderPath: '/home/user/project' });
    const result = await selectWorkspaceFolder();
    expect(result.success).toBe(true);
    expect(result.data).toBe('/home/user/project');
  });

  it('returns error when IPC call fails', async () => {
    mockSelectFolder.mockResolvedValue({ success: false, error: 'User cancelled' });
    const result = await selectWorkspaceFolder();
    expect(result.success).toBe(false);
    expect(result.error).toBe('User cancelled');
  });

  it('returns error on thrown exception', async () => {
    mockSelectFolder.mockRejectedValue(new Error('IPC error'));
    const result = await selectWorkspaceFolder();
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/IPC error/);
  });
});
