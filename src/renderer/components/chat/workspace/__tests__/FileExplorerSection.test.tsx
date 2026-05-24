/** @vitest-environment happy-dom */

import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FileExplorerSection from '../FileExplorerSection';

const mockGetWorkspaceFileTree = vi.fn();
const mockGetDirectoryChildren = vi.fn();
const mockClearFileTreeCache = vi.fn();
const mockCopyPathsToWorkspace = vi.fn();
const mockStartWatch = vi.fn(async (..._args: unknown[]) => ({ success: true }));
const mockStopWatch = vi.fn(async (..._args: unknown[]) => ({ success: true }));
const mockOnRefresh = vi.fn((..._args: unknown[]) => vi.fn());

vi.mock('../../../../lib/chat/workspaceOps', async () => ({
  getWorkspaceFileTree: (workspacePath: string, options?: unknown) => mockGetWorkspaceFileTree(workspacePath, options),
  getDirectoryChildren: (dirPath: string, options?: unknown) => mockGetDirectoryChildren(dirPath, options),
  clearFileTreeCache: (workspacePath?: string) => mockClearFileTreeCache(workspacePath),
  isValidWorkspacePath: (value: string) => Boolean(value),
  startWatch: (workspacePath: string, options?: unknown) => mockStartWatch(workspacePath, options),
  stopWatch: () => mockStopWatch(),
  copyPathToWorkspace: vi.fn(),
  copyPathsToWorkspace: (sourcePaths: string[], workspacePath: string, options?: unknown) => (
    mockCopyPathsToWorkspace(sourcePaths, workspacePath, options)
  ),
  openInSystemExplorer: vi.fn(),
  workspaceOps: {
    onRefresh: (listener: () => void) => mockOnRefresh(listener),
  },
}));

vi.mock('../PasteToWorkspaceProvider', async () => ({
  usePasteToWorkspace: () => ({
    openPasteDialog: vi.fn(),
  }),
}));


describe('FileExplorerSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // happy-dom may not provide localStorage.clear in all Node versions; polyfill if missing
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

    mockGetWorkspaceFileTree.mockImplementation(async (workspacePath: string) => ({
      success: true,
      data: {
        tree: workspacePath === '/knowledge-b'
          ? [
              {
                name: 'metrics-review',
                path: '/knowledge-b/metrics-review',
                type: 'directory',
                children: [],
              },
            ]
          : [
              {
                name: 'cycles',
                path: '/knowledge/cycles',
                type: 'directory',
                children: [],
              },
            ],
      },
    }));

    mockGetDirectoryChildren.mockImplementation(async (dirPath: string) => ({
      success: true,
      data: {
        dirPath,
        children: dirPath === '/knowledge-b/metrics-review'
          ? [
              {
                name: 'beta.md',
                path: '/knowledge-b/metrics-review/beta.md',
                type: 'file',
              },
            ]
          : [
              {
                name: 'alpha.md',
                path: '/knowledge/cycles/alpha.md',
                type: 'file',
              },
            ],
      },
    }));

    mockClearFileTreeCache.mockResolvedValue({ success: true });
    mockCopyPathsToWorkspace.mockResolvedValue({
      success: true,
      data: { successCount: 1 },
    });

    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      writable: true,
      value: {
        fs: {
          selectFiles: vi.fn(async () => ({
            success: true,
            filePaths: ['/tmp/new-file.md'],
          })),
        },
      },
    });
  });

  it('reloads expanded directory children after add-files refresh rebuilds the root tree', async () => {
    const user = userEvent.setup();
    let capturedMenuActions: any;

    localStorage.setItem('fileTree_expanded_/knowledge', JSON.stringify(['/knowledge/cycles']));

    render(
      <FileExplorerSection
        title="Agent Knowledge Files"
        sectionClassName="knowledge-explorer-sidepane-section"
        currentPath="/knowledge"
        defaultPath="/knowledge"
        currentChatId="chat-1"
        onUpdatePath={vi.fn(async () => undefined)}
        onMenuToggle={(_button, actions) => {
          capturedMenuActions = actions;
        }}
      />
    );

    await screen.findByText('cycles');
    await screen.findByText('alpha.md');
    expect(mockGetDirectoryChildren).toHaveBeenCalledTimes(1);

    await user.click(screen.getByTitle('More options'));
    await waitFor(() => expect(capturedMenuActions).toBeDefined());

    await act(async () => {
      await capturedMenuActions.onAddFiles();
    });

    await waitFor(() => expect(mockGetWorkspaceFileTree).toHaveBeenCalledTimes(2));
    await screen.findByText('alpha.md');
    expect(mockGetDirectoryChildren).toHaveBeenCalledTimes(2);
  });

  it('switches knowledge paths without reusing stale expanded-folder cache from the previous path', async () => {
    localStorage.setItem('fileTree_expanded_/knowledge', JSON.stringify(['/knowledge/cycles']));
    localStorage.setItem('fileTree_expanded_/knowledge-b', JSON.stringify(['/knowledge-b/metrics-review']));

    const { rerender } = render(
      <FileExplorerSection
        title="Agent Knowledge Files"
        sectionClassName="knowledge-explorer-sidepane-section"
        currentPath="/knowledge"
        defaultPath="/knowledge"
        currentChatId="chat-1"
        onUpdatePath={vi.fn(async () => undefined)}
      />
    );

    await screen.findByText('cycles');
    await screen.findByText('alpha.md');

    rerender(
      <FileExplorerSection
        title="Agent Knowledge Files"
        sectionClassName="knowledge-explorer-sidepane-section"
        currentPath="/knowledge-b"
        defaultPath="/knowledge-b"
        currentChatId="chat-2"
        onUpdatePath={vi.fn(async () => undefined)}
      />
    );

    await screen.findByText('metrics-review');
    await waitFor(() => expect(mockGetDirectoryChildren).toHaveBeenCalledWith(
      '/knowledge-b/metrics-review',
      { ignorePatterns: expect.any(Array) }
    ));
    expect(screen.queryByText('alpha.md')).toBeNull();
  });
});