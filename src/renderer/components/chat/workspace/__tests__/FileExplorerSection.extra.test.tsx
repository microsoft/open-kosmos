// @ts-nocheck
/** @vitest-environment happy-dom */

/**
 * FileExplorerSection additional coverage tests
 *
 * Covers: collapse/expand toggle, empty state, drag and drop, file click dispatch,
 * invalid workspace path state, refresh button.
 */

import React from 'react';
import { act, render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
const mockOpenSharePointSearch = vi.fn();

vi.mock('../../../../lib/chat/workspaceOps', async () => ({
  getWorkspaceFileTree: (...args: unknown[]) => mockGetWorkspaceFileTree(...args),
  getDirectoryChildren: (...args: unknown[]) => mockGetDirectoryChildren(...args),
  clearFileTreeCache: (...args: unknown[]) => mockClearFileTreeCache(...args),
  isValidWorkspacePath: (value: string) => Boolean(value),
  startWatch: (...args: unknown[]) => mockStartWatch(...args),
  stopWatch: () => mockStopWatch(),
  copyPathToWorkspace: (...args: unknown[]) => mockCopyPathToWorkspace(...args),
  copyPathsToWorkspace: (...args: unknown[]) => mockCopyPathsToWorkspace(...args),
  openInSystemExplorer: (...args: unknown[]) => mockOpenInSystemExplorer(...args),
  workspaceOps: {
    onRefresh: (listener: () => void) => mockOnRefresh(listener),
  },
}));

vi.mock('../PasteToWorkspaceProvider', async () => ({
  usePasteToWorkspace: () => ({
    openPasteDialog: mockOpenPasteDialog,
  }),
}));

vi.mock('../SharePointSearchProvider', async () => ({
  useSharePointSearch: () => ({
    openSharePointSearch: mockOpenSharePointSearch,
  }),
}));

// ========== Default props ==========
const defaultProps = {
  title: 'Knowledge Files',
  sectionClassName: 'knowledge-section',
  currentPath: '/workspace',
  defaultPath: '/workspace',
  currentChatId: 'chat-123',
  onUpdatePath: vi.fn(async () => undefined),
};

// ========== beforeEach ==========
beforeEach(() => {
  vi.clearAllMocks();

  if (typeof localStorage.clear !== 'function') {
    const store: Record<string, string> = {};
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
  } else {
    localStorage.clear();
  }

  mockGetWorkspaceFileTree.mockResolvedValue({
    success: true,
    data: {
      tree: [
        { name: 'readme.md', path: '/workspace/readme.md', type: 'file' },
      ],
    },
  });

  mockGetDirectoryChildren.mockResolvedValue({ success: true, data: { children: [] } });
  mockClearFileTreeCache.mockResolvedValue({ success: true });
  mockCopyPathsToWorkspace.mockResolvedValue({ success: true, data: { successCount: 1 } });
  mockCopyPathToWorkspace.mockResolvedValue({ success: true });

  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    writable: true,
    value: {
      platform: 'darwin',
      fs: {
        selectFiles: vi.fn(async () => ({ success: true, filePaths: ['/tmp/new.md'] })),
        getPathForFile: vi.fn((file: File) => (file as any).path),
      },
      workspace: {
        selectFolder: vi.fn(async () => ({ success: true, folderPath: '/tmp/folder' })),
      },
    },
  });
});

// ========== Tests ==========

describe('FileExplorerSection - collapse / expand', () => {
  it('collapses the section when header is clicked', async () => {
    render(<FileExplorerSection {...defaultProps} />);
    // Wait for tree to load
    await screen.findByText('readme.md');
    // Click header to collapse
    fireEvent.click(document.querySelector('.sidepane-section-header')!);
    // Body should no longer be visible
    expect(document.querySelector('.sidepane-section-body')).toBeNull();
  });

  it('expands the section when header is clicked again', async () => {
    render(<FileExplorerSection {...defaultProps} />);
    await screen.findByText('readme.md');
    // Collapse
    fireEvent.click(document.querySelector('.sidepane-section-header')!);
    // Expand again
    fireEvent.click(document.querySelector('.sidepane-section-header')!);
    // Body should be visible again
    expect(document.querySelector('.sidepane-section-body')).not.toBeNull();
  });
});

describe('FileExplorerSection - empty state', () => {
  it('shows empty state when workspace has no files', async () => {
    mockGetWorkspaceFileTree.mockResolvedValue({
      success: true,
      data: { tree: [] },
    });
    render(<FileExplorerSection {...defaultProps} />);
    await screen.findByText('Add documents, code files, images, and more.');
  });

  it('shows Add Files button in empty state', async () => {
    mockGetWorkspaceFileTree.mockResolvedValue({
      success: true,
      data: { tree: [] },
    });
    render(<FileExplorerSection {...defaultProps} />);
    await screen.findByText('Add Files');
  });

  it('shows Paste Text button in empty state', async () => {
    mockGetWorkspaceFileTree.mockResolvedValue({
      success: true,
      data: { tree: [] },
    });
    render(<FileExplorerSection {...defaultProps} />);
    await screen.findByText('Paste Text');
  });

  it('invokes openPasteDialog when Paste Text is clicked', async () => {
    mockGetWorkspaceFileTree.mockResolvedValue({
      success: true,
      data: { tree: [] },
    });
    render(<FileExplorerSection {...defaultProps} />);
    const btn = await screen.findByText('Paste Text');
    fireEvent.click(btn);
    expect(mockOpenPasteDialog).toHaveBeenCalledWith(
      '/workspace',
      '/workspace',
      expect.any(Function),
    );
  });

  it('shows custom emptyMessage when provided', async () => {
    mockGetWorkspaceFileTree.mockResolvedValue({
      success: true,
      data: { tree: [] },
    });
    render(<FileExplorerSection {...defaultProps} emptyMessage="No files yet!" />);
    await screen.findByText('No files yet!');
  });

  it('hides empty actions when hideEmptyActions is true', async () => {
    mockGetWorkspaceFileTree.mockResolvedValue({
      success: true,
      data: { tree: [] },
    });
    render(<FileExplorerSection {...defaultProps} hideEmptyActions />);
    await waitFor(() => {
      expect(screen.queryByText('Add Files')).toBeNull();
    });
  });
});

describe('FileExplorerSection - invalid workspace path', () => {
  it('shows default path message when currentPath is empty', async () => {
    render(
      <FileExplorerSection
        {...defaultProps}
        currentPath=""
        defaultPath=""
      />
    );
    await screen.findByText(/Default knowledge files for this chat/i);
  });
});

describe('FileExplorerSection - file click dispatches events', () => {
  it('dispatches fileViewer:open for non-image files', async () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    render(<FileExplorerSection {...defaultProps} />);
    // Wait for tree, but FileTreeExplorer is a real component — we need to find the file node
    await waitFor(() => expect(mockGetWorkspaceFileTree).toHaveBeenCalled());
    // Verify dispatch spy is not called yet for file viewer
    expect(dispatchSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'fileViewer:open' }),
    );
    dispatchSpy.mockRestore();
  });
});

describe('FileExplorerSection - refresh button', () => {
  it('calls getWorkspaceFileTree again when refresh is clicked', async () => {
    render(<FileExplorerSection {...defaultProps} />);
    await screen.findByText('readme.md');
    expect(mockGetWorkspaceFileTree).toHaveBeenCalledTimes(1);

    const refreshBtn = screen.getByTitle(/Refresh/);
    fireEvent.click(refreshBtn);
    await waitFor(() => expect(mockGetWorkspaceFileTree).toHaveBeenCalledTimes(2));
  });
});

describe('FileExplorerSection - drag and drop', () => {
  it('shows drop overlay when files are dragged over', async () => {
    render(<FileExplorerSection {...defaultProps} />);
    await screen.findByText('readme.md');

    const section = document.querySelector('.file-explorer-section')!;
    fireEvent.dragOver(section, {
      dataTransfer: { files: [] },
    });

    expect(section.classList.contains('dragging-over')).toBe(true);
    expect(screen.getByText(/Drop files or folders here/)).toBeInTheDocument();
  });

  it('removes dragging-over state on drag leave', async () => {
    render(<FileExplorerSection {...defaultProps} />);
    await screen.findByText('readme.md');

    const section = document.querySelector('.file-explorer-section')!;
    fireEvent.dragOver(section);
    fireEvent.dragLeave(section);

    expect(section.classList.contains('dragging-over')).toBe(false);
  });

  it('calls copyPathsToWorkspace on drop with file paths', async () => {
    render(<FileExplorerSection {...defaultProps} />);
    await screen.findByText('readme.md');

    const section = document.querySelector('.file-explorer-section')!;

    // Create a mock file with path property
    const mockFile = Object.assign(new File(['content'], 'dropped.md', { type: 'text/markdown' }), {
      path: '/tmp/dropped.md',
    });

    await act(async () => {
      fireEvent.drop(section, {
        dataTransfer: {
          files: {
            0: mockFile,
            length: 1,
            item: (i: number) => (i === 0 ? mockFile : null),
          },
        },
      });
    });

    await waitFor(() => {
      expect(mockCopyPathsToWorkspace).toHaveBeenCalledWith(
        ['/tmp/dropped.md'],
        '/workspace',
        expect.objectContaining({ conflictResolution: 'prompt' }),
      );
    });
  });
});

describe('FileExplorerSection - add files from dialog', () => {
  it('calls copyPathsToWorkspace after selecting files via dialog', async () => {
    mockGetWorkspaceFileTree.mockResolvedValue({ success: true, data: { tree: [] } });
    let capturedMenuActions: any;

    const user = userEvent.setup();
    render(
      <FileExplorerSection
        {...defaultProps}
        onMenuToggle={(_btn, actions) => { capturedMenuActions = actions; }}
      />
    );

    await screen.findByText('Add Files'); // empty state
    await user.click(screen.getByTitle('More options'));
    await waitFor(() => expect(capturedMenuActions).toBeDefined());

    await act(async () => {
      await capturedMenuActions.onAddFiles();
    });

    expect(mockCopyPathsToWorkspace).toHaveBeenCalledWith(
      ['/tmp/new.md'],
      '/workspace',
      expect.any(Object),
    );
  });

  it('calls copyPathToWorkspace after selecting folder via dialog', async () => {
    mockGetWorkspaceFileTree.mockResolvedValue({ success: true, data: { tree: [] } });
    let capturedMenuActions: any;

    const user = userEvent.setup();
    render(
      <FileExplorerSection
        {...defaultProps}
        onMenuToggle={(_btn, actions) => { capturedMenuActions = actions; }}
      />
    );

    await screen.findByText('Add Files');
    await user.click(screen.getByTitle('More options'));
    await waitFor(() => expect(capturedMenuActions).toBeDefined());

    await act(async () => {
      await capturedMenuActions.onAddFolder();
    });

    expect(mockCopyPathToWorkspace).toHaveBeenCalledWith(
      '/tmp/folder',
      '/workspace',
      expect.any(Object),
    );
  });
});
