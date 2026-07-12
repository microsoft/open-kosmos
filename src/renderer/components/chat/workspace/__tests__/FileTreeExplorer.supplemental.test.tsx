// @ts-nocheck
/** @vitest-environment happy-dom */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import FileTreeExplorer from '../FileTreeExplorer';

vi.mock('@/lib/i18n/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => ({ 'workspace.fileTree.noFiles': 'No files in workspace', 'workspace.fileTree.emptyOrInaccessible': 'Empty or inaccessible' }[key] ?? key), language: 'en', setLanguage: vi.fn() })
}));

vi.mock('lucide-react', () => ({
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

const mockOpenMenu = vi.fn();
vi.mock('../../../menu/FileTreeNodeContextMenu', () => ({
  FileTreeNodeMenuAtom: { useChange: () => ({ open: mockOpenMenu }) },
}));

vi.mock('../../../lib/utilities/logger', () => ({
  createLogger: () => ({ error: vi.fn(), debug: vi.fn() }),
}));

function makeDir(name: string, path: string, children?: any[]) {
  return { name, path, type: 'directory', children };
}
function makeFile(name: string, path: string) {
  return { name, path, type: 'file' };
}

describe('FileTreeExplorer supplemental coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn(), clear: vi.fn() },
    });
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      writable: true,
      value: { workspace: { openPath: vi.fn().mockResolvedValue(undefined) } },
    });
  });

  it('does not throw when the fallback openPath API is missing', async () => {
    (window as any).electronAPI = { workspace: {} };
    render(<FileTreeExplorer nodes={[makeFile('plain.txt', '/repo/plain.txt')]} workspacePath="/repo" />);
    await userEvent.click(screen.getByText('plain.txt'));
    expect(screen.getByText('plain.txt')).toBeInTheDocument();
  });

  it('swallows openPath errors from the fallback file opener', async () => {
    (window as any).electronAPI.workspace.openPath.mockRejectedValueOnce(new Error('boom'));
    render(<FileTreeExplorer nodes={[makeFile('broken.txt', '/repo/broken.txt')]} workspacePath="/repo" />);
    await userEvent.click(screen.getByText('broken.txt'));
    expect(screen.getByText('broken.txt')).toBeInTheDocument();
  });

  it('swallows localStorage write failures when saving expanded directories', async () => {
    (globalThis as any).localStorage.setItem = vi.fn(() => { throw new Error('quota'); });
    const dir = makeDir('root', '/repo/root', [makeFile('child.ts', '/repo/root/child.ts')]);
    render(<FileTreeExplorer nodes={[dir]} workspacePath="/repo" />);
    await userEvent.click(screen.getByText('root'));
    expect(screen.queryByText('child.ts')).toBeNull();
  });

  it('opens the context menu on a directory entry', async () => {
    const dir = makeDir('src', '/repo/src', [makeFile('index.ts', '/repo/src/index.ts')]);
    render(<FileTreeExplorer nodes={[dir]} workspacePath="/repo" />);
    fireEvent.contextMenu(screen.getByText('src'));
    expect(mockOpenMenu).toHaveBeenCalled();
  });
});
