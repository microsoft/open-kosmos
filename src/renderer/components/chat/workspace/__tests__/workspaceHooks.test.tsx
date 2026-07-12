/** @vitest-environment happy-dom */

import { act, renderHook, waitFor } from '@testing-library/react';
import { useWorkspaceFileTree } from '../useWorkspaceFileTree';
import { useWorkspaceRefreshWatcher } from '../useWorkspaceRefreshWatcher';

const mockGetWorkspaceFileTree = vi.fn();
const mockGetDirectoryChildren = vi.fn();
const mockClearFileTreeCache = vi.fn();
const mockStartWatch = vi.fn(async (..._args: unknown[]) => ({ success: true }));
const mockStopWatch = vi.fn(async () => ({ success: true }));
const mockOnRefresh = vi.fn();

vi.mock('../../../../lib/chat/workspaceOps', async () => ({
  getWorkspaceFileTree: (workspacePath: string, options?: unknown) => mockGetWorkspaceFileTree(workspacePath, options),
  getDirectoryChildren: (dirPath: string, options?: unknown) => mockGetDirectoryChildren(dirPath, options),
  clearFileTreeCache: (workspacePath?: string) => mockClearFileTreeCache(workspacePath),
  isValidWorkspacePath: (value: string) => Boolean(value),
  startWatch: (workspacePath: string, options?: unknown) => mockStartWatch(workspacePath, options),
  stopWatch: () => mockStopWatch(),
  workspaceOps: {
    onRefresh: (listener: () => void) => mockOnRefresh(listener),
  },
}));

describe('workspace explorer hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    if (typeof localStorage.clear !== 'function') {
      const store: Record<string, string> = {};
      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: {
          getItem: (key: string) => store[key] ?? null,
          setItem: (key: string, value: string) => { store[key] = value; },
          removeItem: (key: string) => { delete store[key]; },
          clear: () => { Object.keys(store).forEach((key) => delete store[key]); },
        },
      });
    } else {
      localStorage.clear();
    }
    mockOnRefresh.mockReturnValue(vi.fn());
    mockGetWorkspaceFileTree.mockResolvedValue({
      success: true,
      data: { tree: [{ name: 'docs', path: '/workspace/docs', type: 'directory', children: [] }] },
    });
    mockGetDirectoryChildren.mockResolvedValue({
      success: true,
      data: { children: [{ name: 'a.md', path: '/workspace/docs/a.md', type: 'file' }] },
    });
  });

  it('loads roots and lazy children with metadata when needed', async () => {
    const { result } = renderHook(() => useWorkspaceFileTree('/workspace', true));

    await waitFor(() => expect(result.current.fileTree).toHaveLength(1));
    expect(mockGetWorkspaceFileTree).toHaveBeenCalledWith('/workspace', expect.objectContaining({ includeMetadata: true }));

    await act(async () => {
      await result.current.handleLoadChildren('/workspace/docs');
    });

    expect(mockGetDirectoryChildren).toHaveBeenCalledWith('/workspace/docs', expect.objectContaining({ includeMetadata: true }));
    expect(result.current.isChildrenLoaded('/workspace/docs')).toBe(true);
    expect(result.current.fileTree[0].children).toEqual([{ name: 'a.md', path: '/workspace/docs/a.md', type: 'file' }]);
  });

  it('clears cache and reloads the root tree on explicit refresh', async () => {
    const { result } = renderHook(() => useWorkspaceFileTree('/workspace', false));
    await waitFor(() => expect(result.current.fileTree).toHaveLength(1));

    await act(async () => {
      await result.current.reloadRootTree('/workspace', { clearAllCaches: true });
    });

    expect(mockClearFileTreeCache).toHaveBeenCalledWith(undefined);
    expect(mockGetWorkspaceFileTree).toHaveBeenCalledWith('/workspace', expect.objectContaining({ includeMetadata: false }));
  });

  it('starts a watcher and restores expanded folders on refresh events', async () => {
    const reloadRootTree = vi.fn(async () => undefined);
    const handleLoadChildren = vi.fn(async () => undefined);
    localStorage.setItem('fileTree_expanded_/workspace', JSON.stringify(['/workspace/docs']));

    renderHook(() => useWorkspaceRefreshWatcher('/workspace', null, undefined, reloadRootTree, handleLoadChildren));
    await waitFor(() => expect(mockStartWatch).toHaveBeenCalledWith('/workspace', expect.any(Object)));

    const refreshListener = mockOnRefresh.mock.calls[0][0] as () => void;
    await act(async () => {
      await refreshListener();
    });

    expect(reloadRootTree).toHaveBeenCalledWith('/workspace', { clearAllCaches: true });
    expect(handleLoadChildren).toHaveBeenCalledWith('/workspace/docs');
  });

  it('handles reveal requests and reports completion', async () => {
    const reloadRootTree = vi.fn(async () => undefined);
    const handleLoadChildren = vi.fn(async () => undefined);
    const onRevealHandled = vi.fn();

    renderHook(() => useWorkspaceRefreshWatcher('/workspace', { path: '/workspace', nonce: 1 }, onRevealHandled, reloadRootTree, handleLoadChildren));

    await waitFor(() => expect(onRevealHandled).toHaveBeenCalled());
    expect(reloadRootTree).toHaveBeenCalledWith('/workspace', { clearAllCaches: true });
  });
});
