// @ts-nocheck
/** @vitest-environment happy-dom */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockReplaceFilePathInMessages = vi.hoisted(() => vi.fn());
const mockClearFileTreeCache = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockTriggerRefresh = vi.hoisted(() => vi.fn());
const mockLogger = vi.hoisted(() => ({ warn: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() }));

vi.mock('../agentChatSessionCacheManager', () => ({
  agentChatSessionCacheManager: {
    replaceFilePathInMessages: mockReplaceFilePathInMessages,
  },
}));

vi.mock('../workspaceOps', () => ({
  workspaceOps: {
    clearFileTreeCache: mockClearFileTreeCache,
    triggerRefresh: mockTriggerRefresh,
  },
}));

vi.mock('../../utilities/logger', () => ({
  createLogger: () => mockLogger,
}));

import { isPathInKnowledgeBase, moveFileToKnowledgeBase } from '../moveToKnowledgeBase';

describe('moveToKnowledgeBase supplemental coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'confirm', {
      writable: true,
      configurable: true,
      value: vi.fn().mockReturnValue(true),
    });
    Object.defineProperty(window, 'electronAPI', {
      writable: true,
      configurable: true,
      value: {
        workspace: {
          movePath: vi.fn().mockResolvedValue({ success: true }),
        },
        agentChat: {
          replaceFilePathInSession: vi.fn().mockResolvedValue(undefined),
        },
      },
    });
  });

  it('returns false when normalized paths collapse to empty strings', () => {
    expect(isPathInKnowledgeBase('/', '/')).toBe(false);
  });

  it('returns an unavailable error when the move IPC API is missing', async () => {
    Object.defineProperty(window, 'electronAPI', {
      writable: true,
      configurable: true,
      value: { workspace: {} },
    });

    await expect(moveFileToKnowledgeBase('/workspace/file.txt', '/knowledge')).resolves.toEqual({
      success: false,
      error: 'Move file API not available',
    });
  });

  it('asks for confirmation when the target exists and retries with force', async () => {
    const movePath = vi
      .fn()
      .mockResolvedValueOnce({
        success: false,
        error: 'TARGET_EXISTS',
        data: { sourceName: 'file.txt' },
      })
      .mockResolvedValueOnce({ success: true });

    Object.defineProperty(window, 'electronAPI', {
      writable: true,
      configurable: true,
      value: {
        workspace: { movePath },
        agentChat: { replaceFilePathInSession: vi.fn().mockResolvedValue(undefined) },
      },
    });

    const result = await moveFileToKnowledgeBase('/workspace/file.txt', '/knowledge', {
      replaceExistingConfirm: (fileName: string) => `replace:${fileName}`,
    });

    expect(window.confirm).toHaveBeenCalledWith('replace:file.txt');
    expect(movePath).toHaveBeenNthCalledWith(1, '/workspace/file.txt', '/knowledge', undefined);
    expect(movePath).toHaveBeenNthCalledWith(2, '/workspace/file.txt', '/knowledge', { force: true });
    expect(result).toEqual({ success: true, newPath: '/knowledge/file.txt' });
  });

  it('returns a fallback error when movePath fails without an explicit error', async () => {
    window.electronAPI.workspace.movePath = vi.fn().mockResolvedValue({ success: false });

    await expect(moveFileToKnowledgeBase('/workspace/file.txt', '/knowledge')).resolves.toEqual({
      success: false,
      error: 'Failed to move file',
    });
  });

  it('skips source cache clearing when the source directory cannot be derived', async () => {
    const result = await moveFileToKnowledgeBase('file.txt', '/knowledge');

    expect(result).toEqual({ success: true, newPath: '/knowledge/file.txt' });
    expect(mockClearFileTreeCache).toHaveBeenCalledTimes(1);
    expect(mockClearFileTreeCache).toHaveBeenCalledWith('/knowledge');
    expect(mockTriggerRefresh).toHaveBeenCalled();
  });

  it('logs and returns Unknown error when movePath throws a non-Error value', async () => {
    window.electronAPI.workspace.movePath = vi.fn().mockRejectedValue('boom');

    await expect(moveFileToKnowledgeBase('/workspace/file.txt', '/knowledge')).resolves.toEqual({
      success: false,
      error: 'Unknown error',
    });
    expect(mockLogger.error).toHaveBeenCalledWith('[moveToKnowledgeBase] Error:', 'Unknown error');
  });
});
