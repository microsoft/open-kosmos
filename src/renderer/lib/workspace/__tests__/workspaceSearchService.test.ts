/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockSearchFiles = vi.fn();
const mockGetCurrentChat = vi.fn().mockReturnValue(null);

vi.mock('../../userData', () => ({
  profileDataManager: {
    getCurrentChat: (...args: unknown[]) => mockGetCurrentChat(...args),
  },
}));

Object.defineProperty(window, 'electronAPI', {
  value: {
    workspace: {
      searchFiles: (...args: unknown[]) => mockSearchFiles(...args),
    },
  },
  writable: true,
  configurable: true,
});

import {
  searchWorkspaceFiles,
  searchFilesByPattern,
  quickSearchFiles,
} from '../workspaceSearchService';

describe('workspaceSearchService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentChat.mockReturnValue(null);
  });

  // ── searchWorkspaceFiles ──────────────────────────────────────────────────

  describe('searchWorkspaceFiles', () => {
    it('returns empty results when electronAPI.workspace.searchFiles is unavailable', async () => {
      const savedAPI = (window as any).electronAPI;
      (window as any).electronAPI = {};
      const result = await searchWorkspaceFiles({ pattern: 'foo' });
      expect(result).toEqual({ results: [], limitHit: false });
      (window as any).electronAPI = savedAPI;
    });

    it('returns data from a successful IPC call', async () => {
      const data = { results: [{ path: '/src/foo.ts' }], limitHit: false };
      mockSearchFiles.mockResolvedValue({ success: true, data });
      const result = await searchWorkspaceFiles({ pattern: 'foo' });
      expect(result).toEqual(data);
    });

    it('returns empty results when IPC reports failure', async () => {
      mockSearchFiles.mockResolvedValue({ success: false, error: 'boom' });
      const result = await searchWorkspaceFiles({ pattern: 'foo' });
      expect(result).toEqual({ results: [], limitHit: false });
    });

    it('returns empty results when IPC throws', async () => {
      mockSearchFiles.mockRejectedValue(new Error('network error'));
      const result = await searchWorkspaceFiles({ pattern: 'foo' });
      expect(result).toEqual({ results: [], limitHit: false });
    });
  });

  // ── searchFilesByPattern ──────────────────────────────────────────────────

  describe('searchFilesByPattern', () => {
    it('passes pattern and default options to searchWorkspaceFiles', async () => {
      mockSearchFiles.mockResolvedValue({
        success: true,
        data: { results: [{ path: '/src/bar.ts' }], limitHit: false },
      });
      const results = await searchFilesByPattern('bar');
      expect(mockSearchFiles).toHaveBeenCalledWith(
        expect.objectContaining({ pattern: 'bar', fuzzy: true, maxResults: 50, searchTarget: 'both' })
      );
      expect(results).toEqual([{ path: '/src/bar.ts' }]);
    });

    it('respects caller-supplied options', async () => {
      mockSearchFiles.mockResolvedValue({ success: true, data: { results: [], limitHit: false } });
      await searchFilesByPattern('x', { maxResults: 5, fuzzy: false, searchTarget: 'files' });
      expect(mockSearchFiles).toHaveBeenCalledWith(
        expect.objectContaining({ maxResults: 5, fuzzy: false, searchTarget: 'files' })
      );
    });
  });

  // ── quickSearchFiles ──────────────────────────────────────────────────────

  describe('quickSearchFiles', () => {
    it('returns empty array for empty/whitespace pattern', async () => {
      expect(await quickSearchFiles('')).toEqual([]);
      expect(await quickSearchFiles('   ')).toEqual([]);
    });

    it('returns empty array when no workspace is configured', async () => {
      mockGetCurrentChat.mockReturnValue({ agent: {} });
      const results = await quickSearchFiles('foo');
      expect(results).toEqual([]);
      expect(mockSearchFiles).not.toHaveBeenCalled();
    });

    it('passes workspace path and pattern through', async () => {
      mockGetCurrentChat.mockReturnValue({ agent: { workspace: '/home/projects/my-app' } });
      mockSearchFiles.mockResolvedValue({
        success: true,
        data: { results: [{ path: '/home/projects/my-app/src/foo.ts' }], limitHit: false },
      });
      const results = await quickSearchFiles('foo', 10, 'files');
      expect(mockSearchFiles).toHaveBeenCalledWith(
        expect.objectContaining({ folder: '/home/projects/my-app', pattern: 'foo', searchTarget: 'files' })
      );
      expect(results).toHaveLength(1);
    });

    it('returns empty array when profileDataManager.getCurrentChat throws', async () => {
      mockGetCurrentChat.mockImplementation(() => { throw new Error('not ready'); });
      const results = await quickSearchFiles('foo');
      expect(results).toEqual([]);
    });
  });
});
