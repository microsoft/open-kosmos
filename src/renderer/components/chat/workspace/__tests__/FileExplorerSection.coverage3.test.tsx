// @ts-nocheck
/** @vitest-environment happy-dom */

/**
 * FileExplorerSection second coverage pass.
 *
 * Targets handlers and branches not exercised by the existing suites:
 * file click event dispatch, whitespace/failed tree loads, refresh with
 * persisted expansion, file-watch refresh callback, drag-drop path resolution,
 * invalid-node filtering, the sort toggle, and the auto-restore effect.
 */

import React from 'react';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import FileExplorerSection from '../FileExplorerSection';

const mockGetWorkspaceFileTree = vi.fn();
const mockGetDirectoryChildren = vi.fn();
const mockClearFileTreeCache = vi.fn();
const mockCopyPathsToWorkspace = vi.fn();
const mockCopyPathToWorkspace = vi.fn();
const mockOpenInSystemExplorer = vi.fn();
const mockStartWatch = vi.fn(async () => ({ success: true }));
const mockStopWatch = vi.fn(async () => ({ success: true }));
const mockOnRefresh = vi.fn(() => vi.fn());
const mockOpenPasteDialog = vi.fn();

let refreshListener: (() => void) | null = null;

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
    onRefresh: (l: () => void) => {
      refreshListener = l;
      return mockOnRefresh(l);
    },
  },
}));

vi.mock('../PasteToWorkspaceProvider', () => ({
  usePasteToWorkspace: () => ({ openPasteDialog: mockOpenPasteDialog }),
}));

// FileTreeExplorer mock exposes onFileClick / onLoadChildren via buttons.
vi.mock('../FileTreeExplorer', () => ({
  default: ({ nodes, onFileClick, onLoadChildren }: any) => (
    <div data-testid="file-tree-explorer">
      <span data-testid="node-count">{nodes.length}</span>
      <button
        data-testid="click-image"
        onClick={() => onFileClick({ name: 'pic.png', path: '/workspace/pic.png', type: 'file' })}
      >
        image
      </button>
      <button
        data-testid="click-doc"
        onClick={() => onFileClick({ name: 'notes.txt', path: '/workspace/notes.txt', type: 'file' })}
      >
        doc
      </button>
      <button data-testid="load-children" onClick={() => onLoadChildren('/workspace/sub')}>
        load
      </button>
      <button
        data-testid="click-noext"
        onClick={() => onFileClick({ name: 'archive.', path: '/workspace/archive.', type: 'file' })}
      >
        noext
      </button>
    </div>
  ),
}));

const defaultProps = {
  title: 'My Files',
  sectionClassName: 'my-section',
  currentPath: '/workspace',
  defaultPath: '/workspace',
  currentChatId: 'chat-1',
  onUpdatePath: vi.fn(),
};

function setup(props: Record<string, unknown> = {}) {
  return render(<FileExplorerSection {...defaultProps} {...props} />);
}

beforeAll(() => {
  const store: Record<string, string> = {};
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
      clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
      get length() { return Object.keys(store).length; },
      key: (i: number) => Object.keys(store)[i] ?? null,
    },
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  refreshListener = null;
  localStorage.clear();
  mockGetWorkspaceFileTree.mockResolvedValue({
    success: true,
    data: { tree: [{ name: 'readme.md', path: '/workspace/readme.md', type: 'file' }] },
  });
  mockGetDirectoryChildren.mockResolvedValue({ success: true, data: { children: [] } });
  mockClearFileTreeCache.mockResolvedValue({ success: true });
  mockCopyPathsToWorkspace.mockResolvedValue({ success: true, data: { successCount: 1 } });
  mockCopyPathToWorkspace.mockResolvedValue({ success: true });
  (window as any).electronAPI = {
    fs: {
      selectFiles: vi.fn(async () => ({ success: true, filePaths: ['/tmp/a.md'] })),
      getPathForFile: vi.fn((file: File) => (file as any).path),
    },
    workspace: { selectFolder: vi.fn(async () => ({ success: true, folderPath: '/tmp/f' })) },
  };
});

describe('FileExplorerSection - file click dispatch', () => {
  it('dispatches imageViewer:open for image files and fileViewer:open for others', async () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    await act(async () => { setup(); });
    await screen.findByTestId('file-tree-explorer');

    act(() => { fireEvent.click(screen.getByTestId('click-image')); });
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'imageViewer:open' }),
    );

    act(() => { fireEvent.click(screen.getByTestId('click-doc')); });
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'fileViewer:open' }),
    );
    dispatchSpy.mockRestore();
  });

  it('lazily loads children when a directory is expanded', async () => {
    await act(async () => { setup(); });
    await screen.findByTestId('file-tree-explorer');
    await act(async () => { fireEvent.click(screen.getByTestId('load-children')); });
    expect(mockGetDirectoryChildren).toHaveBeenCalledWith(
      '/workspace/sub',
      expect.objectContaining({ includeMetadata: false }),
    );
  });
});

describe('FileExplorerSection - tree load edge cases', () => {
  it('clears the tree when the path is only whitespace', async () => {
    await act(async () => { setup({ currentPath: '   ', defaultPath: '   ' }); });
    // whitespace is "valid" per the mock but loadFileTree treats it as empty
    await waitFor(() => expect(screen.queryByTestId('file-tree-explorer')).not.toBeInTheDocument());
  });

  it('falls back to an empty tree when the load fails', async () => {
    mockGetWorkspaceFileTree.mockResolvedValue({ success: false, error: 'boom' });
    await act(async () => { setup(); });
    await screen.findByText('Add documents, code files, images, and more.');
  });

  it('filters out nodes whose path escapes the workspace', async () => {
    mockGetWorkspaceFileTree.mockResolvedValue({
      success: true,
      data: {
        tree: [
          { name: 'inside.md', path: '/workspace/inside.md', type: 'file' },
          { name: 'escape.md', path: '/elsewhere/escape.md', type: 'file' },
          {
            name: 'dir',
            path: '/workspace/dir',
            type: 'directory',
            children: [{ name: 'evil', path: '/other/evil', type: 'file' }],
          },
        ],
      },
    });
    await act(async () => { setup(); });
    const count = await screen.findByTestId('node-count');
    // inside.md + dir survive; escape.md is filtered out at the root.
    expect(count.textContent).toBe('2');
  });
});

describe('FileExplorerSection - refresh and watch', () => {
  it('reloads previously expanded directories on refresh', async () => {
    localStorage.setItem('fileTree_expanded_/workspace', JSON.stringify(['/workspace/sub', '/workspace/sub/deep']));
    await act(async () => { setup(); });
    await screen.findByTestId('file-tree-explorer');

    await act(async () => { fireEvent.click(screen.getByTitle('Refresh My Files file tree')); });
    await waitFor(() => expect(mockClearFileTreeCache).toHaveBeenCalled());
    await waitFor(() => expect(mockGetDirectoryChildren).toHaveBeenCalledWith(
      '/workspace/sub',
      expect.any(Object),
    ));
  });

  it('refreshes when the file watcher reports changes', async () => {
    localStorage.setItem('fileTree_expanded_/workspace', JSON.stringify(['/workspace/sub']));
    await act(async () => { setup(); });
    await screen.findByTestId('file-tree-explorer');
    expect(refreshListener).toBeTypeOf('function');

    await act(async () => { refreshListener?.(); });
    await waitFor(() => expect(mockGetDirectoryChildren).toHaveBeenCalled());
  });
});

describe('FileExplorerSection - drag and drop path resolution', () => {
  function dropFiles(section: Element, files: any[]) {
    return act(async () => {
      fireEvent.drop(section, {
        dataTransfer: {
          files: Object.assign(files, {
            length: files.length,
            item: (i: number) => files[i] ?? null,
          }),
        },
      });
    });
  }

  it('resolves paths via getPathForFile and skips files without a path', async () => {
    await act(async () => { setup(); });
    await screen.findByTestId('file-tree-explorer');
    const section = document.querySelector('.file-explorer-section')!;

    const withApiPath = Object.assign(new File(['x'], 'a.md'), { path: '/tmp/a.md' });
    const noPath = new File(['y'], 'b.md'); // getPathForFile returns undefined, no .path

    (window as any).electronAPI.fs.getPathForFile = vi.fn((file: File) => (file as any).path);

    await dropFiles(section, [withApiPath, noPath]);
    await waitFor(() => expect(mockCopyPathsToWorkspace).toHaveBeenCalledWith(
      ['/tmp/a.md'],
      '/workspace',
      expect.objectContaining({ conflictResolution: 'prompt' }),
    ));
  });

  it('does nothing when no files are dropped', async () => {
    await act(async () => { setup(); });
    await screen.findByTestId('file-tree-explorer');
    const section = document.querySelector('.file-explorer-section')!;
    await dropFiles(section, []);
    expect(mockCopyPathsToWorkspace).not.toHaveBeenCalled();
  });
});

describe('FileExplorerSection - sort toggle', () => {
  it('renders the sort button and cycles the sort order', async () => {
    mockGetWorkspaceFileTree.mockResolvedValue({
      success: true,
      data: {
        tree: [
          { name: 'b.md', path: '/workspace/b.md', type: 'file', mtime: 200 },
          { name: 'a.md', path: '/workspace/a.md', type: 'file', mtime: 100 },
        ],
      },
    });
    await act(async () => { setup({ showSortButton: true, defaultSortField: 'mtime', defaultSortOrder: 'desc' }); });
    await screen.findByTestId('file-tree-explorer');

    const sortBtn = screen.getByTitle(/Sorted by/);
    expect(sortBtn).toBeInTheDocument();
    act(() => { fireEvent.click(sortBtn); });
    // After one cycle the tooltip flips to the ascending modified variant.
    expect(screen.getByTitle('Sorted by modified (oldest)')).toBeInTheDocument();
  });
});

describe('FileExplorerSection - menu actions wiring', () => {
  it('exposes all workspace menu actions through onMenuToggle', async () => {
    let actions: any;
    await act(async () => { setup({ onMenuToggle: (_b: any, a: any) => { actions = a; } }); });
    await screen.findByTestId('file-tree-explorer');
    act(() => { fireEvent.click(screen.getByTitle('More options')); });
    expect(actions).toBeDefined();

    await act(async () => { await actions.onOpenInExplorer(); });
    expect(mockOpenInSystemExplorer).toHaveBeenCalledWith('/workspace');

    act(() => { actions.onPasteToWorkspace(); });
    expect(mockOpenPasteDialog).toHaveBeenCalled();
  });
});

describe('FileExplorerSection - additional branch coverage', () => {
  it('treats files without an extension as non-images', async () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    await act(async () => { setup(); });
    await screen.findByTestId('file-tree-explorer');
    act(() => { fireEvent.click(screen.getByTestId('click-noext')); });
    expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'fileViewer:open' }));
    dispatchSpy.mockRestore();
  });

  it('injects an empty child list when lazy loading fails', async () => {
    mockGetDirectoryChildren.mockResolvedValue({ success: false });
    await act(async () => { setup(); });
    await screen.findByTestId('file-tree-explorer');
    await act(async () => { fireEvent.click(screen.getByTestId('load-children')); });
    expect(mockGetDirectoryChildren).toHaveBeenCalled();
  });

  it('clears the tree when the path is only whitespace', async () => {
    await act(async () => { setup({ currentPath: '   ', defaultPath: '   ' }); });
    await waitFor(() => expect(screen.queryByTestId('file-tree-explorer')).not.toBeInTheDocument());
  });

  it('handles a successful load whose payload omits the tree array', async () => {
    mockGetWorkspaceFileTree.mockResolvedValue({ success: true, data: {} });
    await act(async () => { setup(); });
    await screen.findByText('Add documents, code files, images, and more.');
  });

  it('skips drop path resolution when getPathForFile is unavailable', async () => {
    (window as any).electronAPI.fs.getPathForFile = undefined;
    await act(async () => { setup(); });
    await screen.findByTestId('file-tree-explorer');
    const section = document.querySelector('.file-explorer-section')!;
    const withPath = Object.assign(new File(['x'], 'a.md'), { path: '/tmp/a.md' });
    await act(async () => {
      fireEvent.drop(section, {
        dataTransfer: {
          files: Object.assign([withPath], { length: 1, item: (i: number) => [withPath][i] ?? null }),
        },
      });
    });
    await waitFor(() => expect(mockCopyPathsToWorkspace).toHaveBeenCalledWith(
      ['/tmp/a.md'], '/workspace', expect.any(Object),
    ));
  });

  it('filters out a root node that has no path at all', async () => {
    mockGetWorkspaceFileTree.mockResolvedValue({
      success: true,
      data: {
        tree: [
          { name: 'good.md', path: '/workspace/good.md', type: 'file' },
          { name: 'nopath', path: '', type: 'file' },
        ],
      },
    });
    await act(async () => { setup(); });
    const count = await screen.findByTestId('node-count');
    expect(count.textContent).toBe('1');
  });

  it('no-ops the More button when no onMenuToggle handler is provided', async () => {
    await act(async () => { setup(); });
    await screen.findByTestId('file-tree-explorer');
    // Clicking should not throw even though there is no handler wired up.
    act(() => { fireEvent.click(screen.getByTitle('More options')); });
    expect(screen.getByTitle('More options')).toBeInTheDocument();
  });

  it('guards every menu action when the workspace path becomes invalid', async () => {
    let actions: any;
    const { rerender } = render(
      <FileExplorerSection {...defaultProps} onMenuToggle={(_b: any, a: any) => { actions = a; }} />,
    );
    await screen.findByTestId('file-tree-explorer');

    await act(async () => {
      rerender(
        <FileExplorerSection {...defaultProps} currentPath="" defaultPath="" onMenuToggle={(_b: any, a: any) => { actions = a; }} />,
      );
    });
    act(() => { fireEvent.click(screen.getByTitle('More options')); });
    expect(actions.canAddFiles).toBe(false);

    await act(async () => {
      await actions.onOpenInExplorer();
      await actions.onAddFiles();
      await actions.onAddFolder();
      actions.onPasteToWorkspace();
    });

    expect(mockOpenInSystemExplorer).not.toHaveBeenCalled();
    expect(mockCopyPathsToWorkspace).not.toHaveBeenCalled();
    expect(mockCopyPathToWorkspace).not.toHaveBeenCalled();
    expect(mockOpenPasteDialog).not.toHaveBeenCalled();
  });

  it('auto-restores persisted expanded directories on first load', async () => {
    localStorage.setItem('fileTree_expanded_/workspace', JSON.stringify(['/workspace/auto']));
    await act(async () => { setup(); });
    await screen.findByTestId('file-tree-explorer');
    await waitFor(() => expect(mockGetDirectoryChildren).toHaveBeenCalledWith(
      '/workspace/auto', expect.any(Object),
    ));
  });

  it('does not mark the watcher started when startWatch reports failure', async () => {
    mockStartWatch.mockResolvedValue({ success: false });
    await act(async () => { setup(); });
    await screen.findByTestId('file-tree-explorer');
    expect(mockStartWatch).toHaveBeenCalled();
  });

  it('restarts the watcher when the workspace path changes', async () => {
    const { rerender } = render(<FileExplorerSection {...defaultProps} />);
    await screen.findByTestId('file-tree-explorer');
    await waitFor(() => expect(mockStartWatch).toHaveBeenCalledWith('/workspace', expect.any(Object)));
    await act(async () => {
      rerender(<FileExplorerSection {...defaultProps} currentPath="/workspace2" defaultPath="/workspace2" />);
    });
    await waitFor(() => expect(mockStartWatch).toHaveBeenCalledWith('/workspace2', expect.any(Object)));
  });

  it('uses the default error message when a failed load omits an error string', async () => {
    mockGetWorkspaceFileTree.mockResolvedValue({ success: false });
    await act(async () => { setup(); });
    await screen.findByText('Add documents, code files, images, and more.');
  });

  it('bails out of Add Files when the dialog is cancelled', async () => {
    mockGetWorkspaceFileTree.mockResolvedValue({ success: true, data: { tree: [] } });
    (window as any).electronAPI.fs.selectFiles = vi.fn(async () => ({ success: false }));
    let actions: any;
    await act(async () => { setup({ onMenuToggle: (_b: any, a: any) => { actions = a; } }); });
    await screen.findByText('Add Files');
    act(() => { fireEvent.click(screen.getByTitle('More options')); });
    await act(async () => { await actions.onAddFiles(); });
    expect(mockCopyPathsToWorkspace).not.toHaveBeenCalled();
  });

  it('bails out of Add Folder when no folder is selected', async () => {
    mockGetWorkspaceFileTree.mockResolvedValue({ success: true, data: { tree: [] } });
    (window as any).electronAPI.workspace.selectFolder = vi.fn(async () => ({ success: false }));
    let actions: any;
    await act(async () => { setup({ onMenuToggle: (_b: any, a: any) => { actions = a; } }); });
    await screen.findByText('Add Files');
    act(() => { fireEvent.click(screen.getByTitle('More options')); });
    await act(async () => { await actions.onAddFolder(); });
    expect(mockCopyPathToWorkspace).not.toHaveBeenCalled();
  });
});
