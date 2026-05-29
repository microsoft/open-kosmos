// @ts-nocheck
/** @vitest-environment happy-dom */

import React from 'react';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import FileExplorerSection from '../FileExplorerSection';

// ── hoisted mocks ──────────────────────────────────────────────────────────
const mockGetWorkspaceFileTree = vi.fn();
const mockClearFileTreeCache = vi.fn();
const mockStartWatch = vi.fn(async () => ({ success: true }));
const mockStopWatch = vi.fn(async () => ({ success: true }));
const mockOnRefresh = vi.fn(() => vi.fn());
const mockOpenPasteDialog = vi.fn();

vi.mock('../../../../lib/chat/workspaceOps', async () => ({
  getWorkspaceFileTree: (...args: unknown[]) => mockGetWorkspaceFileTree(...args),
  getDirectoryChildren: vi.fn(async () => ({ success: true, data: { children: [] } })),
  clearFileTreeCache: (...args: unknown[]) => mockClearFileTreeCache(...args),
  isValidWorkspacePath: (v: string) => Boolean(v),
  startWatch: (...args: unknown[]) => mockStartWatch(...args),
  stopWatch: () => mockStopWatch(),
  copyPathToWorkspace: vi.fn(async () => ({ success: true })),
  copyPathsToWorkspace: vi.fn(async () => ({ success: true, data: { successCount: 1 } })),
  openInSystemExplorer: vi.fn(),
  workspaceOps: {
    onRefresh: (l: () => void) => mockOnRefresh(l),
  },
}));

vi.mock('../PasteToWorkspaceProvider', () => ({
  usePasteToWorkspace: () => ({ openPasteDialog: mockOpenPasteDialog }),
}));

vi.mock('../FileTreeExplorer', () => ({
  default: ({ nodes }: { nodes: unknown[] }) => (
    <div data-testid="file-tree-explorer">nodes:{nodes.length}</div>
  ),
}));

// ── helpers ────────────────────────────────────────────────────────────────
const defaultProps = {
  title: 'My Files',
  sectionClassName: 'my-section',
  currentPath: '/workspace/path',
  defaultPath: '/workspace/path',
  currentChatId: 'chat-1',
  onUpdatePath: vi.fn(),
};

function setup(props: Partial<typeof defaultProps> & Record<string, unknown> = {}) {
  return render(<FileExplorerSection {...defaultProps} {...props} />);
}

// polyfill localStorage for happy-dom
beforeAll(() => {
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
});

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mockGetWorkspaceFileTree.mockResolvedValue({
    success: true,
    data: { tree: [{ name: 'readme.md', path: '/workspace/path/readme.md', type: 'file' }] },
  });
});

// ── tests ──────────────────────────────────────────────────────────────────

describe('FileExplorerSection – rendering', () => {
  it('renders the section title', async () => {
    await act(async () => { setup(); });
    expect(screen.getByText('My Files')).toBeInTheDocument();
  });

  it('shows the refresh button when path is valid and not collapsed', async () => {
    await act(async () => { setup(); });
    expect(screen.getByTitle('Refresh My Files file tree')).toBeInTheDocument();
  });

  it('shows file tree explorer when files are loaded', async () => {
    await act(async () => { setup(); });
    await waitFor(() => expect(screen.getByTestId('file-tree-explorer')).toBeInTheDocument());
  });

  it('shows empty state when tree is empty', async () => {
    mockGetWorkspaceFileTree.mockResolvedValue({ success: true, data: { tree: [] } });
    await act(async () => { setup(); });
    expect(screen.getByText(/Add documents/i)).toBeInTheDocument();
  });

  it('shows custom emptyMessage when provided', async () => {
    mockGetWorkspaceFileTree.mockResolvedValue({ success: true, data: { tree: [] } });
    await act(async () => { setup({ emptyMessage: 'Nothing here yet.' }); });
    expect(screen.getByText('Nothing here yet.')).toBeInTheDocument();
  });

  it('hides action buttons when hideEmptyActions is true', async () => {
    mockGetWorkspaceFileTree.mockResolvedValue({ success: true, data: { tree: [] } });
    await act(async () => { setup({ hideEmptyActions: true, emptyMessage: 'No files.' }); });
    expect(screen.queryByText('Add Files')).not.toBeInTheDocument();
  });

  it('shows invalid path state when currentPath is empty', async () => {
    await act(async () => { setup({ currentPath: '', defaultPath: '' }); });
    expect(screen.getByText(/Default My Files/i)).toBeInTheDocument();
  });
});

describe('FileExplorerSection – collapse/expand', () => {
  it('collapses section body when header is clicked', async () => {
    await act(async () => { setup(); });
    const header = screen.getByText('My Files').closest('.sidepane-section-header')!;
    act(() => { fireEvent.click(header); });
    expect(screen.queryByTestId('file-tree-explorer')).not.toBeInTheDocument();
  });

  it('expands again on second click', async () => {
    await act(async () => { setup(); });
    await waitFor(() => expect(screen.getByTestId('file-tree-explorer')).toBeInTheDocument());
    const header = screen.getByText('My Files').closest('.sidepane-section-header')!;
    act(() => { fireEvent.click(header); });
    expect(screen.queryByTestId('file-tree-explorer')).not.toBeInTheDocument();
    act(() => { fireEvent.click(header); });
    await waitFor(() => expect(screen.getByTestId('file-tree-explorer')).toBeInTheDocument());
  });
});

describe('FileExplorerSection – drag and drop', () => {
  it('shows drop overlay while dragging over', async () => {
    await act(async () => { setup(); });
    const section = document.querySelector('.file-explorer-section')!;
    act(() => {
      fireEvent.dragOver(section, { dataTransfer: {} });
    });
    expect(screen.getByText(/Drop files or folders here/i)).toBeInTheDocument();
  });

  it('hides drop overlay on drag leave', async () => {
    await act(async () => { setup(); });
    const section = document.querySelector('.file-explorer-section')!;
    act(() => { fireEvent.dragOver(section, { dataTransfer: {} }); });
    act(() => { fireEvent.dragLeave(section, { dataTransfer: {} }); });
    expect(screen.queryByText(/Drop files or folders here/i)).not.toBeInTheDocument();
  });
});

describe('FileExplorerSection – menu toggle', () => {
  it('calls onMenuToggle when more button is clicked', async () => {
    const onMenuToggle = vi.fn();
    await act(async () => { setup({ onMenuToggle }); });
    fireEvent.click(screen.getByTitle('More options'));
    expect(onMenuToggle).toHaveBeenCalled();
  });
});

describe('FileExplorerSection – reveal request', () => {
  it('triggers refresh when revealRequest matches path', async () => {
    const onRevealHandled = vi.fn();
    await act(async () => {
      render(
        <FileExplorerSection
          {...defaultProps}
          revealRequest={{ path: '/workspace/path', nonce: 1 }}
          onRevealHandled={onRevealHandled}
        />
      );
    });
    await waitFor(() => expect(mockClearFileTreeCache).toHaveBeenCalled());
  });
});

describe('FileExplorerSection – empty state actions', () => {
  beforeEach(() => {
    mockGetWorkspaceFileTree.mockResolvedValue({ success: true, data: { tree: [] } });
    (window as any).electronAPI = {
      fs: {
        selectFiles: vi.fn(async () => ({ success: false })),
        getPathForFile: vi.fn(),
      },
      workspace: {
        selectFolder: vi.fn(async () => ({ success: false })),
      },
    };
  });

  it('renders Add Files button', async () => {
    await act(async () => { setup(); });
    expect(screen.getByText('Add Files')).toBeInTheDocument();
  });

  it('renders Add Folder button', async () => {
    await act(async () => { setup(); });
    expect(screen.getByText('Add Folder')).toBeInTheDocument();
  });

  it('calls openPasteDialog when Paste Text is clicked', async () => {
    await act(async () => { setup(); });
    act(() => { fireEvent.click(screen.getByText('Paste Text')); });
    expect(mockOpenPasteDialog).toHaveBeenCalledWith('/workspace/path', '/workspace/path', expect.any(Function));
  });

});
