// @ts-nocheck
/** @vitest-environment happy-dom */

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import FileTreeExplorer from '../FileTreeExplorer';
import type { FileTreeNode } from '../../../../lib/chat/workspaceOps';

vi.mock('lucide-react', async () => ({
  Folder: () => <span data-testid="icon-folder" />,
  FolderOpen: () => <span data-testid="icon-folder-open" />,
  FileText: () => <span data-testid="icon-file-text" />,
  FileCode: () => <span data-testid="icon-file-code" />,
  FileJson: () => <span data-testid="icon-file-json" />,
  FileType: () => <span data-testid="icon-file-type" />,
  Palette: () => <span data-testid="icon-palette" />,
  Globe: () => <span data-testid="icon-globe" />,
  Image: () => <span data-testid="icon-image" />,
  ChevronRight: () => <span data-testid="icon-chevron-right" />,
  ChevronDown: () => <span data-testid="icon-chevron-down" />,
}));

const mockFileTreeNodeMenuOpen = vi.fn();
vi.mock('../../../menu/FileTreeNodeContextMenu', async () => ({
  FileTreeNodeMenuAtom: {
    useChange: () => ({ open: mockFileTreeNodeMenuOpen }),
  },
}));

vi.mock('../../../lib/utilities/logger', async () => ({
  createLogger: () => ({ error: vi.fn(), debug: vi.fn() }),
}));

vi.mock('../../../lib/chat/workspaceOps', async () => ({
  FileTreeNode: undefined,
}));

// Helper to set up localStorage
function setupLocalStorage() {
  const store: Record<string, string> = {};
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
      clear: () => { Object.keys(store).forEach(k => delete store[k]); },
    },
  });
}

function makeDir(name: string, path: string, children?: FileTreeNode[]): FileTreeNode {
  return { name, path, type: 'directory', children };
}

function makeFile(name: string, path: string): FileTreeNode {
  return { name, path, type: 'file' };
}

describe('FileTreeExplorer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupLocalStorage();
    localStorage.clear();

    Object.defineProperty(window, 'electronAPI', {
      writable: true, configurable: true,
      value: {
        workspace: {
          openPath: vi.fn().mockResolvedValue(undefined),
        },
      },
    });
  });

  it('shows empty state when nodes is empty', () => {
    render(<FileTreeExplorer nodes={[]} workspacePath="/workspace" />);
    expect(screen.getByText('No files in workspace')).toBeInTheDocument();
  });

  it('renders file nodes', () => {
    const nodes: FileTreeNode[] = [makeFile('README.md', '/ws/README.md')];
    render(<FileTreeExplorer nodes={nodes} workspacePath="/ws" />);
    expect(screen.getByText('README.md')).toBeInTheDocument();
  });

  it('renders directory node as collapsed by default when multiple roots', () => {
    // Multiple roots: auto-expand does NOT trigger for any of them
    const dir = makeDir('src', '/ws/src', [makeFile('index.ts', '/ws/src/index.ts')]);
    const file = makeFile('README.md', '/ws/README.md');
    render(<FileTreeExplorer nodes={[dir, file]} workspacePath="/ws" />);
    expect(screen.getByText('src')).toBeInTheDocument();
    // child not visible since not auto-expanded
    expect(screen.queryByText('index.ts')).not.toBeInTheDocument();
  });

  it('auto-expands single root directory', () => {
    const dir = makeDir('root', '/ws/root', [makeFile('file.ts', '/ws/root/file.ts')]);
    render(<FileTreeExplorer nodes={[dir]} workspacePath="/ws" />);
    // Single root dir is auto-expanded — child is visible
    expect(screen.getByText('file.ts')).toBeInTheDocument();
  });

  it('expands directory on click', () => {
    const dir = makeDir('src', '/ws/src', [makeFile('index.ts', '/ws/src/index.ts')]);
    const file = makeFile('README.md', '/ws/README.md');
    render(<FileTreeExplorer nodes={[dir, file]} workspacePath="/ws" />);
    expect(screen.queryByText('index.ts')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('src'));
    expect(screen.getByText('index.ts')).toBeInTheDocument();
  });

  it('collapses expanded directory on second click', () => {
    const dir = makeDir('root', '/ws/root', [makeFile('file.ts', '/ws/root/file.ts')]);
    render(<FileTreeExplorer nodes={[dir]} workspacePath="/ws" />);
    // Initially auto-expanded
    expect(screen.getByText('file.ts')).toBeInTheDocument();
    // Click to collapse
    fireEvent.click(screen.getByText('root'));
    expect(screen.queryByText('file.ts')).not.toBeInTheDocument();
  });

  it('calls onFileClick when file is clicked', () => {
    const onFileClick = vi.fn();
    const nodes: FileTreeNode[] = [makeFile('app.ts', '/ws/app.ts')];
    render(<FileTreeExplorer nodes={nodes} workspacePath="/ws" onFileClick={onFileClick} />);
    fireEvent.click(screen.getByText('app.ts'));
    expect(onFileClick).toHaveBeenCalledWith(expect.objectContaining({ name: 'app.ts' }));
  });

  it('opens file via electronAPI when no onFileClick provided', async () => {
    const nodes: FileTreeNode[] = [makeFile('app.ts', '/ws/app.ts')];
    render(<FileTreeExplorer nodes={nodes} workspacePath="/ws" />);
    await act(async () => {
      fireEvent.click(screen.getByText('app.ts'));
    });
    expect(window.electronAPI.workspace.openPath).toHaveBeenCalledWith('/ws/app.ts');
  });

  it('calls onLoadChildren when expanding a directory', async () => {
    const onLoadChildren = vi.fn().mockResolvedValue(undefined);
    const dir = makeDir('src', '/ws/src', [makeFile('index.ts', '/ws/src/index.ts')]);
    const file = makeFile('README.md', '/ws/README.md');
    render(
      <FileTreeExplorer
        nodes={[dir, file]}
        workspacePath="/ws2"
        onLoadChildren={onLoadChildren}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByText('src'));
    });
    expect(onLoadChildren).toHaveBeenCalledWith('/ws/src');
  });

  it('does not call onLoadChildren when collapsing', async () => {
    const onLoadChildren = vi.fn().mockResolvedValue(undefined);
    const dir = makeDir('root', '/ws/root', [makeFile('file.ts', '/ws/root/file.ts')]);
    render(
      <FileTreeExplorer
        nodes={[dir]}
        workspacePath="/ws"
        onLoadChildren={onLoadChildren}
      />,
    );
    // root is auto-expanded — clicking collapses it
    await act(async () => {
      fireEvent.click(screen.getByText('root'));
    });
    expect(onLoadChildren).not.toHaveBeenCalled();
  });

  it('opens context menu on right-click', () => {
    const nodes: FileTreeNode[] = [makeFile('app.ts', '/ws/app.ts')];
    render(<FileTreeExplorer nodes={nodes} workspacePath="/ws" />);
    fireEvent.contextMenu(screen.getByText('app.ts'));
    expect(mockFileTreeNodeMenuOpen).toHaveBeenCalledWith(
      expect.any(Number),
      expect.any(Number),
      expect.objectContaining({ name: 'app.ts' }),
      '/ws',
    );
  });

  it('saves expanded dirs to localStorage', () => {
    const dir = makeDir('src', '/ws/src', [makeFile('index.ts', '/ws/src/index.ts')]);
    const file = makeFile('README.md', '/ws/README.md');
    render(<FileTreeExplorer nodes={[dir, file]} workspacePath="/ws" />);
    // Click to expand src
    fireEvent.click(screen.getByText('src'));
    const stored = localStorage.getItem('fileTree_expanded_/ws');
    expect(stored).toBeTruthy();
    expect(JSON.parse(stored!)).toContain('/ws/src');
  });

  it('restores expanded state from localStorage', () => {
    localStorage.setItem('fileTree_expanded_/ws', JSON.stringify(['/ws/src']));
    const dir = makeDir('src', '/ws/src', [makeFile('index.ts', '/ws/src/index.ts')]);
    render(<FileTreeExplorer nodes={[dir]} workspacePath="/ws" />);
    // Should be expanded since it was stored
    expect(screen.getByText('index.ts')).toBeInTheDocument();
  });

  it('handles invalid localStorage gracefully', () => {
    localStorage.setItem('fileTree_expanded_/ws', 'not-json');
    const dir = makeDir('src', '/ws/src', [makeFile('index.ts', '/ws/src/index.ts')]);
    // Should not throw
    expect(() => {
      render(<FileTreeExplorer nodes={[dir]} workspacePath="/ws" />);
    }).not.toThrow();
  });

  it('shows correct icon for .ts files', () => {
    const nodes: FileTreeNode[] = [makeFile('app.ts', '/ws/app.ts')];
    render(<FileTreeExplorer nodes={nodes} workspacePath="/ws" />);
    expect(screen.getByTestId('icon-file-code')).toBeInTheDocument();
  });

  it('shows correct icon for .tsx files', () => {
    const nodes: FileTreeNode[] = [makeFile('App.tsx', '/ws/App.tsx')];
    render(<FileTreeExplorer nodes={nodes} workspacePath="/ws" />);
    expect(screen.getByTestId('icon-file-code')).toBeInTheDocument();
  });

  it('shows correct icon for .json files', () => {
    const nodes: FileTreeNode[] = [makeFile('config.json', '/ws/config.json')];
    render(<FileTreeExplorer nodes={nodes} workspacePath="/ws" />);
    expect(screen.getByTestId('icon-file-json')).toBeInTheDocument();
  });

  it('shows correct icon for .md files', () => {
    const nodes: FileTreeNode[] = [makeFile('README.md', '/ws/README.md')];
    render(<FileTreeExplorer nodes={nodes} workspacePath="/ws" />);
    expect(screen.getByTestId('icon-file-type')).toBeInTheDocument();
  });

  it('shows correct icon for .css files', () => {
    const nodes: FileTreeNode[] = [makeFile('style.css', '/ws/style.css')];
    render(<FileTreeExplorer nodes={nodes} workspacePath="/ws" />);
    expect(screen.getByTestId('icon-palette')).toBeInTheDocument();
  });

  it('shows correct icon for .html files', () => {
    const nodes: FileTreeNode[] = [makeFile('index.html', '/ws/index.html')];
    render(<FileTreeExplorer nodes={nodes} workspacePath="/ws" />);
    expect(screen.getByTestId('icon-globe')).toBeInTheDocument();
  });

  it('shows correct icon for .png files', () => {
    const nodes: FileTreeNode[] = [makeFile('logo.png', '/ws/logo.png')];
    render(<FileTreeExplorer nodes={nodes} workspacePath="/ws" />);
    expect(screen.getByTestId('icon-image')).toBeInTheDocument();
  });

  it('shows generic file icon for unknown extension', () => {
    const nodes: FileTreeNode[] = [makeFile('binary.bin', '/ws/binary.bin')];
    render(<FileTreeExplorer nodes={nodes} workspacePath="/ws" />);
    expect(screen.getByTestId('icon-file-text')).toBeInTheDocument();
  });

  it('shows FolderOpen icon for expanded directory', () => {
    const dir = makeDir('root', '/ws/root', [makeFile('file.ts', '/ws/root/file.ts')]);
    render(<FileTreeExplorer nodes={[dir]} workspacePath="/ws" />);
    // Auto-expanded single root dir
    expect(screen.getByTestId('icon-folder-open')).toBeInTheDocument();
  });

  it('renders nested children at deeper levels', () => {
    const nested = makeDir('src', '/ws/src', [
      makeDir('utils', '/ws/src/utils', [makeFile('helpers.ts', '/ws/src/utils/helpers.ts')]),
    ]);
    render(<FileTreeExplorer nodes={[nested]} workspacePath="/ws" />);
    // src auto-expanded
    expect(screen.getByText('utils')).toBeInTheDocument();
    // utils needs click to expand
    fireEvent.click(screen.getByText('utils'));
    expect(screen.getByText('helpers.ts')).toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(
      <FileTreeExplorer nodes={[makeFile('f.ts', '/ws/f.ts')]} workspacePath="/ws" className="custom-class" />,
    );
    expect(container.firstChild).toHaveClass('custom-class');
  });

  it('renders multiple root nodes', () => {
    const nodes: FileTreeNode[] = [
      makeFile('a.ts', '/ws/a.ts'),
      makeFile('b.ts', '/ws/b.ts'),
    ];
    render(<FileTreeExplorer nodes={nodes} workspacePath="/ws" />);
    expect(screen.getByText('a.ts')).toBeInTheDocument();
    expect(screen.getByText('b.ts')).toBeInTheDocument();
  });
});
