// @ts-nocheck
/** @vitest-environment happy-dom */

/**
 * FileExplorerSection – coverage pass 2
 *
 * Targets uncovered branches in the second coverage pass:
 *  - isImageFile: filename with empty extension (|| '' fallback)
 *  - handleLoadChildren: getDirectoryChildren failure + null children
 *  - loadFileTree: result.success=false with no error field; treeData.tree undefined
 *  - handleRefresh: invalid workspacePath branch (via matching reveal request)
 *  - startFileWatcher: startWatch returns success=false (line 256 false branch),
 *      fileChangeListenerRef cleanup (line 239 true branch)
 *  - handleFileClick: image dispatch vs non-image dispatch
 *  - handleDrop: missing electronAPI.fs, missing data field in copyResult
 *  - handleAddFiles: invalid path early return; missing data field in copyResult
 *  - handleAddFolder: invalid path early return
 *  - handleMenuToggle: without onMenuToggle prop (line 478 false branch)
 *  - handleOpenPasteDialog: invalid path early return
 *  - openPasteDialog callback invocation (fn 33)
 *  - sort comparators in handleRefresh (fn 11) and handleFileChanges (fn 15)
 *    exercised via prevExpanded with ≥2 entries
 *  - auto-restore forEach callback: already-cached directory skip (fn 41)
 */

import React from 'react';
import { act, render, screen, waitFor, fireEvent } from '@testing-library/react';
import FileExplorerSection from '../FileExplorerSection';

// ── mocks ─────────────────────────────────────────────────────────────────────
const mockGetWorkspaceFileTree = vi.fn();
const mockGetDirectoryChildren = vi.fn();
const mockClearFileTreeCache = vi.fn();
const mockCopyPathsToWorkspace = vi.fn();
const mockCopyPathToWorkspace = vi.fn();
const mockOpenInSystemExplorer = vi.fn();
const mockStartWatch = vi.fn(async () => ({ success: true }));
const mockStopWatch = vi.fn(async () => ({ success: true }));
const mockOpenPasteDialog = vi.fn();

// Keep a ref to the onRefresh listener so tests can invoke it
let capturedRefreshListener: (() => void) | null = null;
const mockOnRefresh = vi.fn((listener: () => void) => {
  capturedRefreshListener = listener;
  return () => { capturedRefreshListener = null; };
});

vi.mock('../../../../lib/chat/workspaceOps', async () => ({
  getWorkspaceFileTree: (...args: unknown[]) => mockGetWorkspaceFileTree(...args),
  getDirectoryChildren: (...args: unknown[]) => mockGetDirectoryChildren(...args),
  clearFileTreeCache: (...args: unknown[]) => mockClearFileTreeCache(...args),
  isValidWorkspacePath: (v: string) => Boolean(v),
  startWatch: (...args: unknown[]) => mockStartWatch(...args),
  stopWatch: () => mockStopWatch(),
  copyPathToWorkspace: (...args: unknown[]) => mockCopyPathToWorkspace(...args),
  copyPathsToWorkspace: (...args: unknown[]) => mockCopyPathsToWorkspace(...args),
  openInSystemExplorer: (...args: unknown[]) => mockOpenInSystemExplorer(...args),
  workspaceOps: {
    onRefresh: (listener: () => void) => mockOnRefresh(listener),
  },
}));

vi.mock('../PasteToWorkspaceProvider', () => ({
  usePasteToWorkspace: () => ({ openPasteDialog: mockOpenPasteDialog }),
}));

// FileTreeExplorer mock that exposes file-click handler
vi.mock('../FileTreeExplorer', () => ({
  default: ({ nodes, onFileClick }: any) => (
    <div data-testid="file-tree-explorer">
      {nodes.map((n: any) => (
        <div key={n.path} data-testid={`node-${n.name}`} onClick={() => onFileClick?.(n)}>
          {n.name}
        </div>
      ))}
    </div>
  ),
}));

// ── default props ─────────────────────────────────────────────────────────────
const defaultProps = {
  title: 'My Files',
  sectionClassName: 'my-section',
  currentPath: '/workspace',
  defaultPath: '/workspace',
  currentChatId: 'chat-1',
  onUpdatePath: vi.fn(async () => undefined),
};

// ── localStorage polyfill ─────────────────────────────────────────────────────
const store: Record<string, string> = {};
beforeAll(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
      clear: () => { Object.keys(store).forEach(k => delete store[k]); },
      get length() { return Object.keys(store).length; },
      key: (i: number) => Object.keys(store)[i] ?? null,
    },
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  capturedRefreshListener = null;
  Object.keys(store).forEach(k => delete store[k]);

  mockGetWorkspaceFileTree.mockResolvedValue({
    success: true,
    data: { tree: [{ name: 'readme.md', path: '/workspace/readme.md', type: 'file' }] },
  });
  mockGetDirectoryChildren.mockResolvedValue({ success: true, data: { children: [] } });
  mockClearFileTreeCache.mockResolvedValue({ success: true });
  mockCopyPathsToWorkspace.mockResolvedValue({ success: true, data: { successCount: 1 } });
  mockCopyPathToWorkspace.mockResolvedValue({ success: true });
  mockStartWatch.mockResolvedValue({ success: true });

  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    writable: true,
    value: {
      fs: {
        selectFiles: vi.fn(async () => ({ success: true, filePaths: ['/tmp/a.md'] })),
        getPathForFile: vi.fn((f: File) => (f as any).path ?? undefined),
      },
      workspace: {
        selectFolder: vi.fn(async () => ({ success: true, folderPath: '/tmp/folder' })),
      },
    },
  });
});

// ── TESTS ─────────────────────────────────────────────────────────────────────

describe('FileExplorerSection – isImageFile empty extension (|| "" branch)', () => {
  it('dispatches fileViewer:open for a filename ending with a dot (empty extension)', async () => {
    // filename 'script.' → split('.').pop() = '' → '' || '' → empty string → not an image
    mockGetWorkspaceFileTree.mockResolvedValue({
      success: true,
      data: { tree: [{ name: 'script.', path: '/workspace/script.', type: 'file' }] },
    });
    const events: string[] = [];
    window.addEventListener('fileViewer:open', (e) => events.push(e.type));

    await act(async () => { render(<FileExplorerSection {...defaultProps} />); });
    await waitFor(() => expect(screen.queryByTestId('node-script.')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('node-script.'));

    expect(events).toContain('fileViewer:open');
  });
});

describe('FileExplorerSection – handleFileClick image dispatch', () => {
  it('dispatches imageViewer:open for .png files', async () => {
    mockGetWorkspaceFileTree.mockResolvedValue({
      success: true,
      data: { tree: [{ name: 'photo.png', path: '/workspace/photo.png', type: 'file' }] },
    });
    const events: string[] = [];
    window.addEventListener('imageViewer:open', (e) => events.push(e.type));

    await act(async () => { render(<FileExplorerSection {...defaultProps} />); });
    await waitFor(() => expect(screen.queryByTestId('node-photo.png')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('node-photo.png'));

    expect(events).toContain('imageViewer:open');
  });

  it('dispatches fileViewer:open for .md files with tree origin', async () => {
    const events: CustomEvent[] = [];
    window.addEventListener('fileViewer:open', (e) => events.push(e as CustomEvent));

    await act(async () => { render(<FileExplorerSection {...defaultProps} />); });
    await waitFor(() => expect(screen.queryByTestId('node-readme.md')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('node-readme.md'));

    expect(events).toHaveLength(1);
    expect(events[0].detail.origin).toBe('tree');
  });
});

describe('FileExplorerSection – handleLoadChildren failure paths', () => {
  it('sets empty children when getDirectoryChildren returns success=false', async () => {
    const dirNode = { name: 'docs', path: '/workspace/docs', type: 'directory', children: [] };
    mockGetWorkspaceFileTree.mockResolvedValue({ success: true, data: { tree: [dirNode] } });
    mockGetDirectoryChildren.mockResolvedValue({ success: false });
    store['fileTree_expanded_/workspace'] = JSON.stringify(['/workspace/docs']);

    await act(async () => { render(<FileExplorerSection {...defaultProps} />); });
    await waitFor(() => expect(mockGetDirectoryChildren).toHaveBeenCalled());
    // Component should still render without crashing
    expect(screen.getByTestId('file-tree-explorer')).toBeInTheDocument();
  });

  it('handles null children data from getDirectoryChildren', async () => {
    const dirNode = { name: 'docs', path: '/workspace/docs', type: 'directory', children: [] };
    mockGetWorkspaceFileTree.mockResolvedValue({ success: true, data: { tree: [dirNode] } });
    // success: true but no data.children field
    mockGetDirectoryChildren.mockResolvedValue({ success: true, data: {} });
    store['fileTree_expanded_/workspace'] = JSON.stringify(['/workspace/docs']);

    await act(async () => { render(<FileExplorerSection {...defaultProps} />); });
    await waitFor(() => expect(mockGetDirectoryChildren).toHaveBeenCalled());
    expect(screen.getByTestId('file-tree-explorer')).toBeInTheDocument();
  });
});

describe('FileExplorerSection – loadFileTree error branches', () => {
  it('sets fileTree to [] when getWorkspaceFileTree returns success=false with no error field', async () => {
    // result.error is undefined → hits the || 'Failed to load file tree' branch
    mockGetWorkspaceFileTree.mockResolvedValue({ success: false });
    await act(async () => { render(<FileExplorerSection {...defaultProps} />); });
    await waitFor(() => expect(mockGetWorkspaceFileTree).toHaveBeenCalled());
    // Shows empty state because fileTree is [] and path is valid
    expect(screen.getByText(/Add documents/i)).toBeInTheDocument();
  });

  it('sets fileTree to [] when treeData.tree is undefined', async () => {
    // treeData.tree || [] → hits the || [] branch
    mockGetWorkspaceFileTree.mockResolvedValue({ success: true, data: {} });
    await act(async () => { render(<FileExplorerSection {...defaultProps} />); });
    await waitFor(() => expect(mockGetWorkspaceFileTree).toHaveBeenCalled());
    expect(screen.getByText(/Add documents/i)).toBeInTheDocument();
  });
});

describe('FileExplorerSection – handleRefresh with invalid workspacePath', () => {
  it('does not call clearFileTreeCache when workspacePath is empty in handleRefresh', async () => {
    const onRevealHandled = vi.fn();
    // Mount with empty currentPath so workspacePath stays ''
    // Then pass a revealRequest matching '' so handleRefresh is invoked with invalid path
    await act(async () => {
      render(
        <FileExplorerSection
          {...defaultProps}
          currentPath=""
          defaultPath=""
          revealRequest={{ path: '', nonce: 1 }}
          onRevealHandled={onRevealHandled}
        />
      );
    });
    await waitFor(() => expect(onRevealHandled).toHaveBeenCalled());
    // clearFileTreeCache should NOT be called since workspacePath is invalid
    expect(mockClearFileTreeCache).not.toHaveBeenCalled();
  });
});

describe('FileExplorerSection – startFileWatcher: startWatch returns success=false', () => {
  it('covers the startWatch success=false branch (watchStartedRef stays false)', async () => {
    // Make startWatch return failure so watchStartedRef stays false
    mockStartWatch.mockResolvedValue({ success: false });

    await act(async () => { render(<FileExplorerSection {...defaultProps} />); });
    await waitFor(() => expect(mockStartWatch).toHaveBeenCalled());

    // watchStartedRef is still false, so startFileWatcher would run again
    // on next path change (verifies line 256 false branch was exercised)
    expect(mockStartWatch).toHaveBeenCalledTimes(1);
  });

  it('cleans up existing fileChangeListenerRef when startFileWatcher is re-entered', async () => {
    // First call: startWatch returns failure → watchStartedRef=false, fileChangeListenerRef is set
    mockStartWatch.mockResolvedValueOnce({ success: false });

    const { rerender } = render(
      <FileExplorerSection {...defaultProps} currentPath="/workspace" />
    );
    await waitFor(() => expect(mockOnRefresh).toHaveBeenCalledTimes(1));

    // Now change path → stopFileWatcher (returns early since watchStarted=false)
    // Then startFileWatcher for new path → fileChangeListenerRef is non-null → cleanup runs
    await act(async () => {
      rerender(<FileExplorerSection {...defaultProps} currentPath="/workspace2" />);
    });
    await waitFor(() => expect(mockOnRefresh).toHaveBeenCalledTimes(2));
    // Second onRefresh call means fileChangeListenerRef was cleaned up and re-registered
    expect(mockOnRefresh).toHaveBeenCalledTimes(2);
  });
});

describe('FileExplorerSection – handleFileChanges via onRefresh callback', () => {
  it('invokes handleFileChanges when onRefresh listener fires', async () => {
    store['fileTree_expanded_/workspace'] = JSON.stringify(['/workspace/a', '/workspace/b']);

    await act(async () => {
      render(<FileExplorerSection {...defaultProps} />);
    });
    await waitFor(() => expect(mockGetWorkspaceFileTree).toHaveBeenCalledTimes(1));

    expect(capturedRefreshListener).toBeTruthy();
    await act(async () => { await capturedRefreshListener?.(); });

    await waitFor(() => expect(mockGetWorkspaceFileTree).toHaveBeenCalledTimes(2));
  });
});

describe('FileExplorerSection – handleOpenInExplorer', () => {
  it('calls openInSystemExplorer from menu action', async () => {
    let capturedActions: any;
    await act(async () => {
      render(
        <FileExplorerSection
          {...defaultProps}
          onMenuToggle={(_btn, actions) => { capturedActions = actions; }}
        />
      );
    });

    fireEvent.click(screen.getByTitle('More options'));
    await waitFor(() => expect(capturedActions).toBeDefined());

    await act(async () => { await capturedActions.onOpenInExplorer(); });
    expect(mockOpenInSystemExplorer).toHaveBeenCalledWith('/workspace');
  });

  it('does not call openInSystemExplorer when path is invalid', async () => {
    let capturedActions: any;
    await act(async () => {
      render(
        <FileExplorerSection
          {...defaultProps}
          currentPath=""
          defaultPath=""
          onMenuToggle={(_btn, actions) => { capturedActions = actions; }}
        />
      );
    });

    fireEvent.click(screen.getByTitle('More options'));
    await waitFor(() => expect(capturedActions).toBeDefined());

    await act(async () => { await capturedActions.onOpenInExplorer(); });
    expect(mockOpenInSystemExplorer).not.toHaveBeenCalled();
  });

  it('calls stopPropagation when event is provided', async () => {
    let capturedActions: any;
    await act(async () => {
      render(
        <FileExplorerSection
          {...defaultProps}
          onMenuToggle={(_btn, actions) => { capturedActions = actions; }}
        />
      );
    });

    fireEvent.click(screen.getByTitle('More options'));
    await waitFor(() => expect(capturedActions).toBeDefined());

    const mockEvent = { stopPropagation: vi.fn() } as any;
    await act(async () => { await capturedActions.onOpenInExplorer(mockEvent); });
    expect(mockEvent.stopPropagation).toHaveBeenCalled();
  });
});

describe('FileExplorerSection – handleDrop edge cases', () => {
  it('does nothing when drop target has invalid workspace path', async () => {
    await act(async () => {
      render(<FileExplorerSection {...defaultProps} currentPath="" defaultPath="" />);
    });

    const section = document.querySelector('.file-explorer-section')!;
    const mockFile = Object.assign(new File([''], 'x.md'), { path: '/tmp/x.md' });
    await act(async () => {
      fireEvent.drop(section, {
        dataTransfer: { files: { 0: mockFile, length: 1 } },
      });
    });

    expect(mockCopyPathsToWorkspace).not.toHaveBeenCalled();
  });

  it('does nothing when drop has no files', async () => {
    await act(async () => { render(<FileExplorerSection {...defaultProps} />); });
    await waitFor(() => expect(mockGetWorkspaceFileTree).toHaveBeenCalled());

    const section = document.querySelector('.file-explorer-section')!;
    await act(async () => {
      fireEvent.drop(section, { dataTransfer: { files: { length: 0 } } });
    });

    expect(mockCopyPathsToWorkspace).not.toHaveBeenCalled();
  });

  it('skips files with no extractable path', async () => {
    await act(async () => { render(<FileExplorerSection {...defaultProps} />); });
    await waitFor(() => expect(mockGetWorkspaceFileTree).toHaveBeenCalled());

    // No getPathForFile in electronAPI.fs; file also has no .path property
    (window as any).electronAPI = {
      workspace: { selectFolder: vi.fn() },
    };
    const mockFile = new File([''], 'no-path.md');

    const section = document.querySelector('.file-explorer-section')!;
    await act(async () => {
      fireEvent.drop(section, {
        dataTransfer: { files: { 0: mockFile, length: 1 } },
      });
    });

    expect(mockCopyPathsToWorkspace).not.toHaveBeenCalled();
  });

  it('does not reload tree when copyPathsToWorkspace returns missing data', async () => {
    // result.data is undefined → successCount ?? 0 = 0 → no reload
    mockCopyPathsToWorkspace.mockResolvedValue({ success: true });
    await act(async () => { render(<FileExplorerSection {...defaultProps} />); });
    await waitFor(() => expect(mockGetWorkspaceFileTree).toHaveBeenCalledTimes(1));

    const mockFile = Object.assign(new File([''], 'zero.md'), { path: '/tmp/zero.md' });
    const section = document.querySelector('.file-explorer-section')!;
    await act(async () => {
      fireEvent.drop(section, {
        dataTransfer: { files: { 0: mockFile, length: 1 } },
      });
    });
    await waitFor(() => expect(mockCopyPathsToWorkspace).toHaveBeenCalled());

    // No second file-tree load since successCount was 0
    expect(mockGetWorkspaceFileTree).toHaveBeenCalledTimes(1);
  });

  it('uses file.path fallback when getPathForFile is absent', async () => {
    await act(async () => { render(<FileExplorerSection {...defaultProps} />); });
    await waitFor(() => expect(mockGetWorkspaceFileTree).toHaveBeenCalled());

    (window as any).electronAPI = { workspace: { selectFolder: vi.fn() } };
    const mockFile = Object.assign(new File([''], 'fallback.md'), { path: '/tmp/fallback.md' });

    const section = document.querySelector('.file-explorer-section')!;
    await act(async () => {
      fireEvent.drop(section, {
        dataTransfer: { files: { 0: mockFile, length: 1 } },
      });
    });

    await waitFor(() =>
      expect(mockCopyPathsToWorkspace).toHaveBeenCalledWith(
        ['/tmp/fallback.md'], '/workspace', expect.any(Object),
      )
    );
  });

  it('handles getPathForFile throwing an error and falls back to file.path', async () => {
    await act(async () => { render(<FileExplorerSection {...defaultProps} />); });
    await waitFor(() => expect(mockGetWorkspaceFileTree).toHaveBeenCalled());

    (window as any).electronAPI.fs.getPathForFile = vi.fn(() => { throw new Error('err'); });
    const mockFile = Object.assign(new File([''], 'throw.md'), { path: '/tmp/throw.md' });

    const section = document.querySelector('.file-explorer-section')!;
    await act(async () => {
      fireEvent.drop(section, {
        dataTransfer: { files: { 0: mockFile, length: 1 } },
      });
    });

    await waitFor(() =>
      expect(mockCopyPathsToWorkspace).toHaveBeenCalledWith(
        ['/tmp/throw.md'], '/workspace', expect.any(Object),
      )
    );
  });
});

describe('FileExplorerSection – handleAddFiles edge cases', () => {
  it('does not call copyPaths when handleAddFiles is called with invalid workspacePath', async () => {
    mockGetWorkspaceFileTree.mockResolvedValue({ success: true, data: { tree: [] } });
    let capturedActions: any;
    await act(async () => {
      render(
        <FileExplorerSection
          {...defaultProps}
          currentPath=""
          defaultPath=""
          onMenuToggle={(_btn, actions) => { capturedActions = actions; }}
        />
      );
    });
    fireEvent.click(screen.getByTitle('More options'));
    await waitFor(() => expect(capturedActions).toBeDefined());

    await act(async () => { await capturedActions.onAddFiles(); });
    expect(mockCopyPathsToWorkspace).not.toHaveBeenCalled();
  });

  it('does not reload tree when add-files copy returns no data field (successCount ?? 0)', async () => {
    mockCopyPathsToWorkspace.mockResolvedValue({ success: true }); // no data field
    mockGetWorkspaceFileTree.mockResolvedValue({ success: true, data: { tree: [] } });
    let capturedActions: any;
    await act(async () => {
      render(
        <FileExplorerSection
          {...defaultProps}
          onMenuToggle={(_btn, actions) => { capturedActions = actions; }}
        />
      );
    });
    fireEvent.click(screen.getByTitle('More options'));
    await waitFor(() => expect(capturedActions).toBeDefined());

    await act(async () => { await capturedActions.onAddFiles(); });
    await waitFor(() => expect(mockCopyPathsToWorkspace).toHaveBeenCalled());
    // Only the initial load; no reload since count was 0
    expect(mockGetWorkspaceFileTree).toHaveBeenCalledTimes(1);
  });

  it('does not call copyPaths when selectFiles returns empty filePaths', async () => {
    (window as any).electronAPI.fs.selectFiles = vi.fn(async () => ({
      success: true, filePaths: [],
    }));
    mockGetWorkspaceFileTree.mockResolvedValue({ success: true, data: { tree: [] } });
    let capturedActions: any;
    await act(async () => {
      render(
        <FileExplorerSection
          {...defaultProps}
          onMenuToggle={(_btn, actions) => { capturedActions = actions; }}
        />
      );
    });
    fireEvent.click(screen.getByTitle('More options'));
    await waitFor(() => expect(capturedActions).toBeDefined());

    await act(async () => { await capturedActions.onAddFiles(); });
    expect(mockCopyPathsToWorkspace).not.toHaveBeenCalled();
  });
});

describe('FileExplorerSection – handleAddFolder edge cases', () => {
  it('does not copy when handleAddFolder is called with invalid workspacePath', async () => {
    mockGetWorkspaceFileTree.mockResolvedValue({ success: true, data: { tree: [] } });
    let capturedActions: any;
    await act(async () => {
      render(
        <FileExplorerSection
          {...defaultProps}
          currentPath=""
          defaultPath=""
          onMenuToggle={(_btn, actions) => { capturedActions = actions; }}
        />
      );
    });
    fireEvent.click(screen.getByTitle('More options'));
    await waitFor(() => expect(capturedActions).toBeDefined());

    await act(async () => { await capturedActions.onAddFolder(); });
    expect(mockCopyPathToWorkspace).not.toHaveBeenCalled();
  });

  it('does not copy when selectFolder returns no folderPath', async () => {
    (window as any).electronAPI.workspace.selectFolder = vi.fn(async () => ({
      success: true, folderPath: undefined,
    }));
    mockGetWorkspaceFileTree.mockResolvedValue({ success: true, data: { tree: [] } });
    let capturedActions: any;
    await act(async () => {
      render(
        <FileExplorerSection
          {...defaultProps}
          onMenuToggle={(_btn, actions) => { capturedActions = actions; }}
        />
      );
    });
    fireEvent.click(screen.getByTitle('More options'));
    await waitFor(() => expect(capturedActions).toBeDefined());

    await act(async () => { await capturedActions.onAddFolder(); });
    expect(mockCopyPathToWorkspace).not.toHaveBeenCalled();
  });
});

describe('FileExplorerSection – handleMenuToggle without onMenuToggle', () => {
  it('does not throw when menu button is clicked without onMenuToggle prop', async () => {
    await act(async () => {
      render(<FileExplorerSection {...defaultProps} onMenuToggle={undefined} />);
    });
    await waitFor(() => expect(mockGetWorkspaceFileTree).toHaveBeenCalled());

    // Click should not throw — menuButtonRef.current && onMenuToggle is false
    expect(() => {
      fireEvent.click(screen.getByTitle('More options'));
    }).not.toThrow();
  });
});

describe('FileExplorerSection – handleOpenPasteDialog with invalid path', () => {
  it('does not call openPasteDialog when workspacePath is empty', async () => {
    mockGetWorkspaceFileTree.mockResolvedValue({ success: true, data: { tree: [] } });
    let capturedActions: any;
    await act(async () => {
      render(
        <FileExplorerSection
          {...defaultProps}
          currentPath=""
          defaultPath=""
          onMenuToggle={(_btn, actions) => { capturedActions = actions; }}
        />
      );
    });
    fireEvent.click(screen.getByTitle('More options'));
    await waitFor(() => expect(capturedActions).toBeDefined());

    capturedActions.onPasteToWorkspace();
    expect(mockOpenPasteDialog).not.toHaveBeenCalled();
  });

  it('invokes the openPasteDialog callback to reload the tree', async () => {
    mockGetWorkspaceFileTree.mockResolvedValue({ success: true, data: { tree: [] } });
    await act(async () => { render(<FileExplorerSection {...defaultProps} />); });
    await waitFor(() => expect(mockGetWorkspaceFileTree).toHaveBeenCalledTimes(1));

    // Click Paste Text button in empty state
    await act(async () => { fireEvent.click(screen.getByText('Paste Text')); });
    expect(mockOpenPasteDialog).toHaveBeenCalled();

    // Extract and invoke the callback (fn 33 at line 459)
    const [,, pasteCallback] = mockOpenPasteDialog.mock.calls[0];
    await act(async () => { await pasteCallback(); });

    await waitFor(() => expect(mockGetWorkspaceFileTree).toHaveBeenCalledTimes(2));
  });
});

describe('FileExplorerSection – sort comparators in handleRefresh (fn 11)', () => {
  it('sorts prevExpanded with at least 2 entries (exercises the sort comparator)', async () => {
    // 2+ entries ensures the sort comparator function is called at least once
    store['fileTree_expanded_/workspace'] = JSON.stringify([
      '/workspace/deep/nested/dir',
      '/workspace/shallow',
    ]);
    mockGetWorkspaceFileTree.mockResolvedValue({
      success: true,
      data: { tree: [{ name: 'readme.md', path: '/workspace/readme.md', type: 'file' }] },
    });

    await act(async () => { render(<FileExplorerSection {...defaultProps} />); });
    await waitFor(() => expect(mockGetWorkspaceFileTree).toHaveBeenCalled());

    const refreshBtn = screen.getByTitle('Refresh My Files file tree');
    await act(async () => { fireEvent.click(refreshBtn); });

    // Refresh ran with prevExpanded sorted — verifies fn 11 sort comparator
    await waitFor(() => expect(mockGetWorkspaceFileTree).toHaveBeenCalledTimes(2));
  });
});

describe('FileExplorerSection – sort comparators in handleFileChanges (fn 15)', () => {
  it('sorts prevExpanded in handleFileChanges with at least 2 entries', async () => {
    store['fileTree_expanded_/workspace'] = JSON.stringify([
      '/workspace/deep/nested',
      '/workspace/shallow',
    ]);
    mockGetWorkspaceFileTree.mockResolvedValue({
      success: true,
      data: { tree: [{ name: 'readme.md', path: '/workspace/readme.md', type: 'file' }] },
    });

    await act(async () => { render(<FileExplorerSection {...defaultProps} />); });
    await waitFor(() => expect(mockGetWorkspaceFileTree).toHaveBeenCalledTimes(1));

    expect(capturedRefreshListener).toBeTruthy();
    await act(async () => { await capturedRefreshListener?.(); });

    await waitFor(() => expect(mockGetWorkspaceFileTree).toHaveBeenCalledTimes(2));
  });
});

describe('FileExplorerSection – auto-restore forEach callback (fn 41)', () => {
  it('skips already-cached directories in the auto-restore effect', async () => {
    store['fileTree_expanded_/workspace'] = JSON.stringify(['/workspace/docs']);
    mockGetDirectoryChildren.mockResolvedValue({
      success: true,
      data: { children: [{ name: 'file.md', path: '/workspace/docs/file.md', type: 'file' }] },
    });
    mockGetWorkspaceFileTree.mockResolvedValue({
      success: true,
      data: {
        tree: [{ name: 'docs', path: '/workspace/docs', type: 'directory', children: [] }],
      },
    });

    await act(async () => { render(<FileExplorerSection {...defaultProps} />); });
    // First auto-restore: docs not in cache → getDirectoryChildren called → adds to cache
    await waitFor(() => expect(mockGetDirectoryChildren).toHaveBeenCalledTimes(1));

    // After getDirectoryChildren, setFileTree is called → auto-restore runs again
    // This time, docs IS in cache → forEach callback hits the cache-hit branch
    // No second getDirectoryChildren call
    await new Promise(r => setTimeout(r, 100));
    expect(mockGetDirectoryChildren).toHaveBeenCalledTimes(1);
  });
});

describe('FileExplorerSection – revealRequest with collapse restore', () => {
  it('expands a collapsed section when a matching revealRequest arrives', async () => {
    const onRevealHandled = vi.fn();
    const { rerender } = render(
      <FileExplorerSection
        {...defaultProps}
        revealRequest={null}
        onRevealHandled={onRevealHandled}
      />
    );
    await waitFor(() => expect(mockGetWorkspaceFileTree).toHaveBeenCalled());

    // Collapse the section
    fireEvent.click(document.querySelector('.sidepane-section-header')!);
    expect(document.querySelector('.sidepane-section-body')).toBeNull();

    // Set a matching reveal request
    await act(async () => {
      rerender(
        <FileExplorerSection
          {...defaultProps}
          revealRequest={{ path: '/workspace', nonce: 99 }}
          onRevealHandled={onRevealHandled}
        />
      );
    });

    await waitFor(() => expect(onRevealHandled).toHaveBeenCalled());
    expect(document.querySelector('.sidepane-section-body')).not.toBeNull();
  });
});

describe('FileExplorerSection – reloadRootTree clearAllCaches=true', () => {
  it('calls clearFileTreeCache without args when clearAllCaches is true (via refresh)', async () => {
    await act(async () => { render(<FileExplorerSection {...defaultProps} />); });
    await waitFor(() => expect(mockGetWorkspaceFileTree).toHaveBeenCalled());

    const refreshBtn = screen.getByTitle('Refresh My Files file tree');
    await act(async () => { fireEvent.click(refreshBtn); });

    await waitFor(() => expect(mockClearFileTreeCache).toHaveBeenCalled());
    // clearAllCaches=true → called with no argument (undefined)
    const callsWithNoArg = mockClearFileTreeCache.mock.calls.filter(args => args[0] === undefined);
    expect(callsWithNoArg.length).toBeGreaterThan(0);
  });
});
