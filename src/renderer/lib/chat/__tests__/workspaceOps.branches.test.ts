// @ts-nocheck
/** @vitest-environment happy-dom */
/**
 * Branch coverage for workspaceOps: exercises the default-error fallbacks
 * (IPC returns `{ success: false }` with no error string) and the non-Error
 * catch paths (`error instanceof Error ? ... : 'Unknown error'`) for every
 * wrapper method.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSelectFolder = vi.fn();
const mockGetFileTree = vi.fn();
const mockCopyPath = vi.fn();
const mockCopyPaths = vi.fn();
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
      copyPaths: mockCopyPaths,
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
  configurable: true,
});

const mockUpdateChat = vi.fn();
const mockUpdateChatAgent = vi.fn();
vi.mock('../chatOps', () => ({
  updateChat: (...args: unknown[]) => mockUpdateChat(...args),
  updateChatAgent: (...args: unknown[]) => mockUpdateChatAgent(...args),
}));

import {
  WorkspaceOpsManager,
  getWorkspaceFileTree,
  getDirectoryChildren,
  clearFileTreeCache,
  updateChatWorkspace,
  updateChatKnowledgeBase,
  startWatch,
  stopWatch,
  getWatcherStats,
  copyPathToWorkspace,
  copyPathsToWorkspace,
  openInSystemExplorer,
} from '../workspaceOps';

function freshManager(): WorkspaceOpsManager {
  (WorkspaceOpsManager as any).instance = null;
  return WorkspaceOpsManager.getInstance();
}

beforeEach(() => vi.clearAllMocks());

describe('workspaceOps default-error fallbacks (no error string from IPC)', () => {
  it('selectWorkspaceFolder uses the default error', async () => {
    mockSelectFolder.mockResolvedValue({ success: false });
    const result = await freshManager().selectWorkspaceFolder();
    expect(result.error).toBe('Failed to select folder');
  });

  it('getWorkspaceFileTree uses the default error', async () => {
    mockGetFileTree.mockResolvedValue({ success: false });
    const result = await getWorkspaceFileTree('/p');
    expect(result.error).toBe('Failed to get file tree');
  });

  it('getDirectoryChildren uses the default error', async () => {
    mockGetDirectoryChildren.mockResolvedValue({ success: false });
    const result = await getDirectoryChildren('/p');
    expect(result.error).toBe('Failed to get directory children');
  });

  it('clearFileTreeCache uses the default error', async () => {
    mockClearFileTreeCache.mockResolvedValue({ success: false });
    const result = await clearFileTreeCache('/p');
    expect(result.error).toBe('Failed to clear file tree cache');
  });

  it('updateChatWorkspace uses the default error', async () => {
    mockUpdateChat.mockResolvedValue({ success: false });
    const result = await updateChatWorkspace('c', '/p');
    expect(result.error).toBe('Failed to update chat workspace');
  });

  it('updateChatKnowledgeBase uses the default error', async () => {
    mockUpdateChatAgent.mockResolvedValue({ success: false });
    const result = await updateChatKnowledgeBase('c', '/p');
    expect(result.error).toBe('Failed to update chat knowledge base');
  });

  it('startWatch uses the default error', async () => {
    mockStartWatch.mockResolvedValue({ success: false });
    const result = await startWatch('/p');
    expect(result.error).toBe('Failed to start file watcher');
  });

  it('stopWatch uses the default error', async () => {
    mockStartWatch.mockResolvedValue({ success: true });
    mockStopWatch.mockResolvedValue({ success: false });
    const mgr = freshManager();
    await mgr.startWatch('/p');
    const result = await mgr.stopWatch();
    expect(result.error).toBe('Failed to stop file watcher');
  });

  it('getWatcherStats uses the default error', async () => {
    mockGetWatcherStats.mockResolvedValue({ success: false });
    const result = await getWatcherStats();
    expect(result.error).toBe('Failed to get watcher stats');
  });

  it('copyPathToWorkspace uses the default error', async () => {
    mockCopyPath.mockResolvedValue({ success: false });
    const result = await copyPathToWorkspace('/s', '/d');
    expect(result.error).toBe('Failed to copy path');
  });

  it('copyPathsToWorkspace uses the default error', async () => {
    mockCopyPaths.mockResolvedValue({ success: false });
    const result = await copyPathsToWorkspace(['/s'], '/d');
    expect(result.error).toBe('Failed to copy paths');
  });

  it('openInSystemExplorer uses the default error', async () => {
    mockShowInFolder.mockResolvedValue({ success: false });
    const result = await openInSystemExplorer('/p');
    expect(result.error).toBe('Failed to open in system explorer');
  });
});

describe('workspaceOps non-Error catch paths (Unknown error)', () => {
  it('selectWorkspaceFolder reports Unknown error', async () => {
    mockSelectFolder.mockRejectedValue('boom');
    const result = await freshManager().selectWorkspaceFolder();
    expect(result.error).toBe('Unknown error');
  });

  it('getWorkspaceFileTree reports Unknown error', async () => {
    mockGetFileTree.mockRejectedValue('boom');
    const result = await getWorkspaceFileTree('/p');
    expect(result.error).toBe('Unknown error');
  });

  it('getDirectoryChildren reports Unknown error', async () => {
    mockGetDirectoryChildren.mockRejectedValue('boom');
    const result = await getDirectoryChildren('/p');
    expect(result.error).toBe('Unknown error');
  });

  it('clearFileTreeCache reports Unknown error', async () => {
    mockClearFileTreeCache.mockRejectedValue('boom');
    const result = await clearFileTreeCache('/p');
    expect(result.error).toBe('Unknown error');
  });

  it('updateChatWorkspace reports Unknown error', async () => {
    mockUpdateChat.mockRejectedValue('boom');
    const result = await updateChatWorkspace('c', '/p');
    expect(result.error).toBe('Unknown error');
  });

  it('updateChatKnowledgeBase reports Unknown error', async () => {
    mockUpdateChatAgent.mockRejectedValue('boom');
    const result = await updateChatKnowledgeBase('c', '/p');
    expect(result.error).toBe('Unknown error');
  });

  it('startWatch reports Unknown error', async () => {
    mockStartWatch.mockRejectedValue('boom');
    const result = await startWatch('/p');
    expect(result.error).toBe('Unknown error');
  });

  it('stopWatch reports Unknown error', async () => {
    mockStartWatch.mockResolvedValue({ success: true });
    mockStopWatch.mockRejectedValue('boom');
    const mgr = freshManager();
    await mgr.startWatch('/p');
    const result = await mgr.stopWatch();
    expect(result.error).toBe('Unknown error');
  });

  it('getWatcherStats reports Unknown error', async () => {
    mockGetWatcherStats.mockRejectedValue('boom');
    const result = await getWatcherStats();
    expect(result.error).toBe('Unknown error');
  });

  it('copyPathToWorkspace reports Unknown error', async () => {
    mockCopyPath.mockRejectedValue('boom');
    const result = await copyPathToWorkspace('/s', '/d');
    expect(result.error).toBe('Unknown error');
  });

  it('copyPathsToWorkspace reports Unknown error', async () => {
    mockCopyPaths.mockRejectedValue('boom');
    const result = await copyPathsToWorkspace(['/s'], '/d');
    expect(result.error).toBe('Unknown error');
  });

  it('openInSystemExplorer reports Unknown error', async () => {
    mockShowInFolder.mockRejectedValue('boom');
    const result = await openInSystemExplorer('/p');
    expect(result.error).toBe('Unknown error');
  });
});
