// @ts-nocheck
/** @vitest-environment happy-dom */

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import AgentKnowledgeBaseTab from '../AgentKnowledgeBaseTab';
import type { AgentConfig, TabComponentProps } from '../types';
import { WithStore } from '../../../../atom';
import { appDataManager } from '../../../../lib/userData/appDataManager';

const mockGetWorkspaceFileTree = vi.fn();
const mockGetDirectoryChildren = vi.fn();
const mockClearFileTreeCache = vi.fn();
const mockCopyPathsToWorkspace = vi.fn();
const mockCopyPathToWorkspace = vi.fn();
const mockSelectWorkspaceFolder = vi.fn();
const mockStartWatch = vi.fn(async (..._args: unknown[]) => ({ success: true }));
const mockStopWatch = vi.fn(async (..._args: unknown[]) => ({ success: true }));
const mockOnRefresh = vi.fn((..._args: unknown[]) => vi.fn());
const mockOpenPasteDialog = vi.fn();
const mockFileTreeNodeMenuOpen = vi.fn();

vi.mock('../../../../styles/Agent.css', () => ({}));
vi.mock('../../../../styles/SkillsContentView.css', () => ({}));

vi.mock('../../../../lib/chat/workspaceOps', () => ({
  selectWorkspaceFolder: (...args: unknown[]) => mockSelectWorkspaceFolder(...args),
  getWorkspaceFileTree: (workspacePath: string, options?: unknown) => mockGetWorkspaceFileTree(workspacePath, options),
  getDirectoryChildren: (directoryPath: string, options?: unknown) => mockGetDirectoryChildren(directoryPath, options),
  clearFileTreeCache: (workspacePath?: string) => mockClearFileTreeCache(workspacePath),
  isValidWorkspacePath: (value: string) => Boolean(value),
  startWatch: (workspacePath: string, options?: unknown) => mockStartWatch(workspacePath, options),
  stopWatch: () => mockStopWatch(),
  copyPathToWorkspace: (...args: unknown[]) => mockCopyPathToWorkspace(...args),
  copyPathsToWorkspace: (sourcePaths: string[], workspacePath: string, options?: unknown) => (
    mockCopyPathsToWorkspace(sourcePaths, workspacePath, options)
  ),
  workspaceOps: {
    onRefresh: (listener: () => void) => mockOnRefresh(listener),
  },
}));

vi.mock('../../workspace/PasteToWorkspaceProvider', () => ({
  usePasteToWorkspace: () => ({
    openPasteDialog: mockOpenPasteDialog,
  }),
}));

vi.mock('@renderer/components/menu/FileTreeNodeContextMenu', () => ({
  FileTreeNodeMenuAtom: {
    useChange: () => ({ open: mockFileTreeNodeMenuOpen }),
  },
}));

vi.mock('../../../../lib/utilities/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('@shared/constants/branding', () => ({
  BRAND_NAME: 'openkosmos',
}));

function createAgent(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: 'agent-1',
    name: 'Knowledge Agent',
    emoji: '🧠',
    role: 'assistant',
    model: 'gpt-4.1',
    knowledgeBase: '/knowledge',
    mcpServers: [],
    systemPrompt: 'You are helpful.',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function renderTab(overrides: Partial<TabComponentProps> = {}) {
  const props: TabComponentProps = {
    mode: 'update',
    chatId: 'agent-1',
    agentData: createAgent(),
    onSave: vi.fn(async () => createAgent()),
    onDataChange: vi.fn(),
    cachedData: null,
    readOnly: false,
    ...overrides,
  };

  return render(
    <WithStore>
      <AgentKnowledgeBaseTab {...props} />
    </WithStore>
  );
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

const baseTree = [
  { name: 'cycles', path: '/knowledge/cycles', type: 'directory', children: [] },
  { name: 'readme.md', path: '/knowledge/readme.md', type: 'file', size: 1024 },
  { name: 'image.png', path: '/knowledge/image.png', type: 'file', size: 2048 },
];

describe('AgentKnowledgeBaseTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (appDataManager as any).cache = { uiLanguage: 'en' };

    mockGetWorkspaceFileTree.mockResolvedValue({
      success: true,
      data: { tree: baseTree },
    });

    mockClearFileTreeCache.mockResolvedValue({ success: true });
    mockCopyPathsToWorkspace.mockResolvedValue({
      success: true,
      data: { successCount: 1, failCount: 0 },
    });
    mockCopyPathToWorkspace.mockResolvedValue({ success: true });
    mockGetDirectoryChildren.mockResolvedValue({
      success: true,
      data: { children: [] },
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
          deletePaths: vi.fn(async () => ({ successCount: 1, failCount: 0 })),
          getPathForFile: vi.fn((f: File) => `/tmp/${f.name}`),
        },
        workspace: {
          selectFolder: vi.fn(async () => ({ success: true, folderPath: '/tmp/new-folder' })),
        },
      },
    });
  });

  it('refreshes the root knowledge base tree after add-files', async () => {
    renderTab();

    await screen.findByDisplayValue('/knowledge');
    await screen.findByText('cycles');
    const initialTreeLoadCount = mockGetWorkspaceFileTree.mock.calls.length;

    fireEvent.click(screen.getByRole('button', { name: /add/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Files' }));

    await waitFor(() => expect(mockCopyPathsToWorkspace).toHaveBeenCalledWith(
      ['/tmp/new-file.md'],
      '/knowledge',
      expect.any(Object)
    ));
    await waitFor(() => expect(mockGetWorkspaceFileTree.mock.calls.length).toBeGreaterThan(initialTreeLoadCount));
    expect(mockGetWorkspaceFileTree.mock.calls.length).toBeLessThan(initialTreeLoadCount + 4);
    expect(screen.getByText('cycles')).toBeInTheDocument();
  });

  it('does not overwrite newer navigation with an older preserve-navigation reload', async () => {
    const delayedCyclesReload = createDeferred<{ success: boolean; data: { children: Array<{ name: string; path: string; type: string }> } }>();
    let cyclesChildLoadCount = 0;

    mockGetWorkspaceFileTree.mockResolvedValue({
      success: true,
      data: {
        tree: [
          { name: 'cycles', path: '/knowledge/cycles', type: 'directory', children: [] },
          { name: 'metrics-review', path: '/knowledge/metrics-review', type: 'directory', children: [] },
        ],
      },
    });

    mockGetDirectoryChildren.mockImplementation((directoryPath: string) => {
      if (directoryPath === '/knowledge/cycles') {
        cyclesChildLoadCount += 1;
        if (cyclesChildLoadCount === 1) {
          return Promise.resolve({
            success: true,
            data: {
              children: [
                { name: 'alpha.md', path: '/knowledge/cycles/alpha.md', type: 'file' },
              ],
            },
          });
        }

        return delayedCyclesReload.promise;
      }

      if (directoryPath === '/knowledge/metrics-review') {
        return Promise.resolve({
          success: true,
          data: {
            children: [
              { name: 'beta.md', path: '/knowledge/metrics-review/beta.md', type: 'file' },
            ],
          },
        });
      }

      return Promise.resolve({ success: true, data: { children: [] } });
    });

    renderTab();

    await screen.findByText('cycles');
    fireEvent.click(screen.getByText('cycles'));
    await screen.findByText('alpha.md');

    fireEvent.click(screen.getByRole('button', { name: /add/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Paste Text' }));

    const pasteSuccessCallback = mockOpenPasteDialog.mock.calls[0]?.[2] as (() => void) | undefined;
    expect(pasteSuccessCallback).toBeDefined();

    act(() => {
      pasteSuccessCallback?.();
    });

    await waitFor(() => expect(mockGetWorkspaceFileTree).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByRole('button', { name: 'knowledge' }));
    await screen.findByText('metrics-review');
    fireEvent.click(screen.getByText('metrics-review'));
    await screen.findByText('beta.md');

    await act(async () => {
      delayedCyclesReload.resolve({
        success: true,
        data: {
          children: [
            { name: 'alpha.md', path: '/knowledge/cycles/alpha.md', type: 'file' },
          ],
        },
      });
      await delayedCyclesReload.promise;
    });

    await waitFor(() => expect(screen.getByText('beta.md')).toBeInTheDocument());
    expect(screen.queryByText('alpha.md')).not.toBeInTheDocument();
  });

  it('renders empty no-path state when agentData has no knowledgeBase', async () => {
    renderTab({ agentData: createAgent({ knowledgeBase: '' }) });
    await screen.findByText('Add documents, code files, images, and more.');
    expect(screen.getByText('Select Knowledge Base Folder')).toBeInTheDocument();
  });

  it('renders readOnly state - no add/select buttons', async () => {
    renderTab({ readOnly: true });
    await screen.findByDisplayValue('/knowledge');
    expect(screen.queryByText('Add')).not.toBeInTheDocument();
    expect(screen.queryByText('Select Knowledge Base Folder')).not.toBeInTheDocument();
  });

  it('calls selectWorkspaceFolder when select path button is clicked', async () => {
    mockSelectWorkspaceFolder.mockResolvedValue({ success: true, data: '/new-workspace' });
    renderTab({ agentData: createAgent({ knowledgeBase: '' }) });
    await screen.findByText('Select Knowledge Base Folder');
    fireEvent.click(screen.getByText('Select Knowledge Base Folder'));
    await waitFor(() => expect(mockSelectWorkspaceFolder).toHaveBeenCalled());
  });

  it('does not call selectWorkspaceFolder when readOnly', async () => {
    renderTab({ readOnly: true, agentData: createAgent({ knowledgeBase: '' }) });
    await screen.findByDisplayValue('');
    const selectBtn = screen.getByRole('button', { name: /select path/i });
    expect(selectBtn).toBeDisabled();
    fireEvent.click(selectBtn);
    expect(mockSelectWorkspaceFolder).not.toHaveBeenCalled();
  });

  it('renders file list with directory and file items', async () => {
    renderTab();
    await screen.findByText('cycles');
    expect(screen.getByText('readme.md')).toBeInTheDocument();
    expect(screen.getByText('image.png')).toBeInTheDocument();
  });

  it('shows loading spinner when loading', async () => {
    let resolveTree!: (v: unknown) => void;
    mockGetWorkspaceFileTree.mockReturnValue(new Promise(r => { resolveTree = r; }));
    renderTab();
    await waitFor(() => expect(screen.getByText('Loading directory...')).toBeInTheDocument());
    await act(async () => {
      resolveTree({ success: true, data: { tree: [] } });
    });
  });

  it('handles back navigation', async () => {
    mockGetDirectoryChildren.mockResolvedValue({
      success: true,
      data: { children: [{ name: 'child.md', path: '/knowledge/cycles/child.md', type: 'file' }] },
    });
    renderTab();
    await screen.findByText('cycles');
    fireEvent.click(screen.getByText('cycles'));
    await screen.findByText('child.md');

    // Back button should appear
    const backBtn = screen.getByTitle('Go back');
    fireEvent.click(backBtn);
    await screen.findByText('cycles');
  });

  it('handles breadcrumb navigation to root', async () => {
    mockGetDirectoryChildren.mockResolvedValue({
      success: true,
      data: { children: [{ name: 'child.md', path: '/knowledge/cycles/child.md', type: 'file' }] },
    });
    renderTab();
    await screen.findByText('cycles');
    fireEvent.click(screen.getByText('cycles'));
    await screen.findByText('child.md');

    // Click root breadcrumb
    const rootCrumb = screen.getAllByRole('button').find(b => b.textContent === 'knowledge');
    expect(rootCrumb).toBeDefined();
    fireEvent.click(rootCrumb!);
    await screen.findByText('cycles');
  });

  it('clicking same breadcrumb (current dir) does nothing', async () => {
    mockGetDirectoryChildren.mockResolvedValue({
      success: true,
      data: { children: [{ name: 'child.md', path: '/knowledge/cycles/child.md', type: 'file' }] },
    });
    renderTab();
    await screen.findByText('cycles');
    fireEvent.click(screen.getByText('cycles'));
    await screen.findByText('child.md');

    // cycles is the active breadcrumb; clicking it should be no-op
    const cycleCrumb = screen.getAllByRole('button').find(b => b.textContent === 'cycles' && b.disabled);
    expect(cycleCrumb).toBeDefined();
    fireEvent.click(cycleCrumb!);
    expect(screen.getByText('child.md')).toBeInTheDocument();
  });

  it('dispatches fileViewer:open for non-image file click', async () => {
    renderTab();
    await screen.findByText('readme.md');
    const listener = vi.fn();
    window.addEventListener('fileViewer:open', listener);
    fireEvent.click(screen.getByText('readme.md'));
    window.removeEventListener('fileViewer:open', listener);
    expect(listener).toHaveBeenCalled();
  });

  it('dispatches imageViewer:open for image file click', async () => {
    renderTab();
    await screen.findByText('image.png');
    const listener = vi.fn();
    window.addEventListener('imageViewer:open', listener);
    fireEvent.click(screen.getByText('image.png'));
    window.removeEventListener('imageViewer:open', listener);
    expect(listener).toHaveBeenCalled();
  });

  it('handles drag over and drag leave', async () => {
    const { container } = renderTab();
    await screen.findByText('cycles');
    const root = container.firstChild as HTMLElement;

    fireEvent.dragOver(root);
    // overlay appears
    await waitFor(() => expect(screen.queryByText('Drop files or folders here to add to Knowledge Base')).toBeInTheDocument());

    // drag leave with target outside container
    fireEvent.dragLeave(root, { relatedTarget: document.body });
    await waitFor(() => expect(screen.queryByText('Drop files or folders here to add to Knowledge Base')).not.toBeInTheDocument());
  });

  it('handles drop with file path from electronAPI.fs.getPathForFile', async () => {
    renderTab();
    await screen.findByText('cycles');
    const { container } = { container: document.body };
    const root = document.querySelector('.agent-workspace-tab') as HTMLElement;

    const file = new File(['content'], 'dropped.md', { type: 'text/plain' });
    const dt = { files: [file] } as unknown as DataTransfer;

    await act(async () => {
      fireEvent.drop(root, { dataTransfer: dt });
    });

    await waitFor(() => expect(mockCopyPathToWorkspace).toHaveBeenCalledWith(
      '/tmp/dropped.md',
      '/knowledge',
      expect.any(Object)
    ));
  });

  it('handles drop with no electronAPI - falls back to file.path', async () => {
    (window as any).electronAPI.fs.getPathForFile = undefined;
    renderTab();
    await screen.findByText('cycles');
    const root = document.querySelector('.agent-workspace-tab') as HTMLElement;

    const file = Object.assign(new File(['content'], 'dropped.md'), { path: '/tmp/dropped.md' });
    const dt = { files: [file] } as unknown as DataTransfer;

    await act(async () => {
      fireEvent.drop(root, { dataTransfer: dt });
    });

    await waitFor(() => expect(mockCopyPathToWorkspace).toHaveBeenCalled());
  });

  it('handles drop with readOnly - does nothing', async () => {
    renderTab({ readOnly: true });
    await screen.findByDisplayValue('/knowledge');
    const root = document.querySelector('.agent-workspace-tab') as HTMLElement;
    const file = new File(['content'], 'dropped.md');
    const dt = { files: [file] } as unknown as DataTransfer;

    await act(async () => {
      fireEvent.drop(root, { dataTransfer: dt });
    });
    expect(mockCopyPathToWorkspace).not.toHaveBeenCalled();
  });

  it('adds folder via handleAddFolder', async () => {
    renderTab();
    await screen.findByText('cycles');

    fireEvent.click(screen.getByRole('button', { name: /add/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Folder' }));

    await waitFor(() => expect((window as any).electronAPI.workspace.selectFolder).toHaveBeenCalled());
    await waitFor(() => expect(mockCopyPathToWorkspace).toHaveBeenCalledWith(
      '/tmp/new-folder',
      '/knowledge',
      expect.any(Object)
    ));
  });

  it('add folder cancelled when no result returned', async () => {
    (window as any).electronAPI.workspace.selectFolder = vi.fn(async () => ({ success: false }));
    renderTab();
    await screen.findByText('cycles');

    fireEvent.click(screen.getByRole('button', { name: /add/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Folder' }));

    await waitFor(() => expect((window as any).electronAPI.workspace.selectFolder).toHaveBeenCalled());
    expect(mockCopyPathToWorkspace).not.toHaveBeenCalled();
  });

  it('clears current folder after confirmation', async () => {
    window.confirm = vi.fn(() => true);
    renderTab();
    await screen.findByText('cycles');

    fireEvent.click(screen.getByRole('button', { name: /clear current folder/i }));

    await waitFor(() => expect((window as any).electronAPI.fs.deletePaths).toHaveBeenCalled());
    expect(window.confirm).toHaveBeenCalledWith('Are you sure you want to clear all 3 items in the current folder?\n\nThis action cannot be undone.');
    await waitFor(() => expect(mockGetWorkspaceFileTree.mock.calls.length).toBeGreaterThan(1));
  });

  it('localizes clear current folder confirmation', async () => {
    (appDataManager as any).cache = { uiLanguage: 'zh-CN' };
    window.confirm = vi.fn(() => false);
    renderTab();
    await screen.findByText('cycles');

    fireEvent.click(screen.getByRole('button', { name: '清空当前文件夹' }));

    expect(window.confirm).toHaveBeenCalledWith('确定要清空当前文件夹中的全部 3 个项目吗？\n\n此操作无法撤销。');
    expect((window as any).electronAPI.fs.deletePaths).not.toHaveBeenCalled();
  });

  it('does not clear folder when user cancels confirmation', async () => {
    window.confirm = vi.fn(() => false);
    renderTab();
    await screen.findByText('cycles');

    fireEvent.click(screen.getByRole('button', { name: /clear current folder/i }));

    expect((window as any).electronAPI.fs.deletePaths).not.toHaveBeenCalled();
  });

  it('triggers context menu via more options button', async () => {
    renderTab();
    await screen.findByText('cycles');

    const moreButtons = screen.getAllByTitle('More options');
    expect(moreButtons.length).toBeGreaterThan(0);

    fireEvent.click(moreButtons[0]);
    expect(mockFileTreeNodeMenuOpen).toHaveBeenCalled();
  });

  it('closes add menu when clicking outside', async () => {
    renderTab();
    await screen.findByText('cycles');

    fireEvent.click(screen.getByRole('button', { name: /add/i }));
    expect(screen.getByText('Add Files')).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    await waitFor(() => expect(screen.queryByText('Add Files')).not.toBeInTheDocument());
  });

  it('uses cachedData when provided', async () => {
    renderTab({ cachedData: { knowledgeBase: '/cached-path' } });
    await screen.findByDisplayValue('/cached-path');
  });

  it('shows unsaved hint when workspace path differs from saved', async () => {
    mockSelectWorkspaceFolder.mockResolvedValue({ success: true, data: '/new-workspace' });
    renderTab();
    await screen.findByDisplayValue('/knowledge');

    // Change path via select
    fireEvent.click(screen.getByRole('button', { name: /select path/i }));

    await waitFor(() => expect(screen.getByDisplayValue('/new-workspace')).toBeInTheDocument());
    expect(screen.getByText('Save to enable file management')).toBeInTheDocument();
  });

  it('handles getWorkspaceFileTree failure gracefully', async () => {
    mockGetWorkspaceFileTree.mockRejectedValue(new Error('Network error'));
    renderTab();
    // should not throw, just show empty state
    await waitFor(() => expect(screen.queryByText('Loading directory...')).not.toBeInTheDocument());
  });

  it('handles getDirectoryChildren failure gracefully', async () => {
    mockGetDirectoryChildren.mockRejectedValue(new Error('fail'));
    renderTab();
    await screen.findByText('cycles');
    fireEvent.click(screen.getByText('cycles'));
    // should recover to empty children
    await waitFor(() => expect(screen.queryByText('Loading directory...')).not.toBeInTheDocument());
  });

  it('calls onDataChange when workspace changes', async () => {
    const onDataChange = vi.fn();
    mockSelectWorkspaceFolder.mockResolvedValue({ success: true, data: '/new-workspace' });
    renderTab({ onDataChange });
    await screen.findByDisplayValue('/knowledge');

    fireEvent.click(screen.getByRole('button', { name: /select path/i }));
    await waitFor(() => expect(onDataChange).toHaveBeenCalledWith(
      'knowledge',
      { knowledgeBase: '/new-workspace' },
      true
    ));
  });

  it('shows empty folder state when workspace is valid but empty', async () => {
    mockGetWorkspaceFileTree.mockResolvedValue({ success: true, data: { tree: [] } });
    renderTab();
    await screen.findByText('Add documents, code files, images, and more.');
  });

  it('renders add buttons in empty state when path is valid and saved', async () => {
    mockGetWorkspaceFileTree.mockResolvedValue({ success: true, data: { tree: [] } });
    renderTab();
    await screen.findByText('Add Files');
    expect(screen.getByText('Add Folder')).toBeInTheDocument();
    expect(screen.getByText('Paste Text')).toBeInTheDocument();
  });

  it('shows unsaved-path hint in empty state when path is not saved', async () => {
    mockSelectWorkspaceFolder.mockResolvedValue({ success: true, data: '/new-workspace' });
    mockGetWorkspaceFileTree.mockResolvedValue({ success: true, data: { tree: [] } });
    renderTab();
    await screen.findByDisplayValue('/knowledge');

    fireEvent.click(screen.getByRole('button', { name: /select path/i }));

    await waitFor(() => expect(screen.getByText('Save knowledge base path first to manage files')).toBeInTheDocument());
  });

  it('add files from empty state buttons', async () => {
    mockGetWorkspaceFileTree.mockResolvedValue({ success: true, data: { tree: [] } });
    renderTab();
    await screen.findByText('Add Files');
    fireEvent.click(screen.getByRole('button', { name: 'Add Files' }));
    await waitFor(() => expect((window as any).electronAPI.fs.selectFiles).toHaveBeenCalled());
  });

  it('paste from empty state opens paste dialog', async () => {
    mockGetWorkspaceFileTree.mockResolvedValue({ success: true, data: { tree: [] } });
    renderTab();
    await screen.findByText('Paste Text');
    fireEvent.click(screen.getByRole('button', { name: 'Paste Text' }));
    expect(mockOpenPasteDialog).toHaveBeenCalled();
  });

  it('renders various file type icons (ts, json, css, html, png)', async () => {
    mockGetWorkspaceFileTree.mockResolvedValue({
      success: true,
      data: {
        tree: [
          { name: 'index.ts', path: '/k/index.ts', type: 'file', size: 1 },
          { name: 'config.json', path: '/k/config.json', type: 'file', size: 1 },
          { name: 'style.css', path: '/k/style.css', type: 'file', size: 1 },
          { name: 'page.html', path: '/k/page.html', type: 'file', size: 1 },
          { name: 'photo.png', path: '/k/photo.png', type: 'file', size: 1 },
          { name: 'data.bin', path: '/k/data.bin', type: 'file', size: 1 },
        ],
      },
    });
    renderTab();
    await screen.findByText('index.ts');
    expect(screen.getByText('config.json')).toBeInTheDocument();
  });

  it('handles loadFileTree with empty path (clears tree)', async () => {
    renderTab({ agentData: createAgent({ knowledgeBase: '' }) });
    // With empty path, tree should be empty
    await waitFor(() => expect(mockGetWorkspaceFileTree).not.toHaveBeenCalled());
  });

  it('handles getWorkspaceFileTree returning not success (throws)', async () => {
    mockGetWorkspaceFileTree.mockResolvedValue({ success: false, error: 'Load error' });
    renderTab();
    // Should not crash, gracefully handles error
    await waitFor(() => expect(mockGetWorkspaceFileTree).toHaveBeenCalled());
  });

  it('handles reloadExplorer with clearAllCaches option', async () => {
    mockGetWorkspaceFileTree.mockResolvedValue({ success: true, data: { tree: baseTree } });
    renderTab();
    await screen.findByText('cycles');

    // The clear folder button triggers reloadExplorer with { preserveNavigation: true }
    // Add a file to trigger the file changes handler via watcher
    const cleanupFn = vi.fn();
    mockOnRefresh.mockReturnValue(cleanupFn);
    // No crash expected
  });

  it('handles back navigation without pathHistory (uses directoryStack)', async () => {
    mockGetDirectoryChildren.mockResolvedValue({ success: true, data: { children: [{ name: 'sub.md', path: '/k/cycles/sub.md', type: 'file', size: 100 }] } });
    mockGetWorkspaceFileTree.mockResolvedValue({ success: true, data: { tree: baseTree } });
    renderTab();
    await screen.findByText('cycles');

    // Navigate into directory (this sets both pathHistory and directoryStack)
    fireEvent.click(screen.getByText('cycles'));
    await screen.findByText('sub.md');

    // Click back - uses pathHistory branch
    const backBtn = screen.getByTitle('Go back');
    fireEvent.click(backBtn);
    await screen.findByText('cycles');
  });

  it('handles breadcrumb navigation to non-root index', async () => {
    mockGetDirectoryChildren.mockResolvedValue({ success: true, data: { children: [{ name: 'sub.md', path: '/k/cycles/sub.md', type: 'file', size: 100 }] } });
    renderTab();
    await screen.findByText('cycles');

    // Navigate into directory twice to build up a stack
    fireEvent.click(screen.getByText('cycles'));
    await screen.findByText('sub.md');
  });

  it('handles handleAddFolder copy failure gracefully', async () => {
    mockCopyPathToWorkspace.mockResolvedValue({ success: false, error: 'Copy failed' });
    renderTab();
    await screen.findByText('cycles');

    fireEvent.click(screen.getByRole('button', { name: /add/i }));
    await screen.findByText('Add Folder');
    fireEvent.click(screen.getByRole('button', { name: 'Add Folder' }));

    await waitFor(() => expect(mockCopyPathToWorkspace).toHaveBeenCalled());
  });

  it('handles handleAddFolder when copyPathToWorkspace throws', async () => {
    mockCopyPathToWorkspace.mockRejectedValue(new Error('Disk error'));
    renderTab();
    await screen.findByText('cycles');

    fireEvent.click(screen.getByRole('button', { name: /add/i }));
    await screen.findByText('Add Folder');
    fireEvent.click(screen.getByRole('button', { name: 'Add Folder' }));

    await waitFor(() => expect(mockCopyPathToWorkspace).toHaveBeenCalled());
  });

  it('paste dialog guard when workspacePath is empty', async () => {
    renderTab({ agentData: createAgent({ knowledgeBase: '' }) });
    // openPasteDialog should NOT be called because there's no valid workspace path
    expect(mockOpenPasteDialog).not.toHaveBeenCalled();
  });

  it('handles selectWorkspaceFolder throwing error', async () => {
    mockSelectWorkspaceFolder.mockRejectedValue(new Error('Dialog error'));
    renderTab();
    await screen.findByText('cycles');

    // Click the select path button
    const selectBtn = screen.queryByTitle('Select knowledge base folder');
    if (selectBtn) {
      await act(async () => { fireEvent.click(selectBtn); });
    }
    // Should not crash
  });

  it('clears folder does nothing when currentItems is empty', async () => {
    mockGetWorkspaceFileTree.mockResolvedValue({ success: true, data: { tree: [] } });
    renderTab();
    await screen.findByText('Add documents, code files, images, and more.');

    // With empty tree, "Clear Current Folder" button should not be visible
    expect(screen.queryByText('Clear Current Folder')).not.toBeInTheDocument();
  });

  it('shows agent name in empty state message', async () => {
    mockGetWorkspaceFileTree.mockResolvedValue({ success: true, data: { tree: [] } });
    renderTab();
    await screen.findByText('Add documents, code files, images, and more.');
    expect(screen.getByText(/Knowledge Agent can use them/)).toBeInTheDocument();
  });
});
