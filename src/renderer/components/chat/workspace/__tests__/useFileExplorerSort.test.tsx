/**
 * @vitest-environment happy-dom
 */

import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  ArrowDownAZ,
  ArrowUpZA,
  ClockArrowDown,
  ClockArrowUp,
} from 'lucide-react';
import { useFileExplorerSort, type SortField, type SortOrder } from '../useFileExplorerSort';
import type { FileTreeNode } from '../../../../lib/chat/workspaceOps';

function setup(overrides: Partial<{ defaultSortField: SortField; defaultSortOrder: SortOrder; showSortButton: boolean }> = {}) {
  return renderHook(() =>
    useFileExplorerSort({
      defaultSortField: overrides.defaultSortField ?? 'mtime',
      defaultSortOrder: overrides.defaultSortOrder ?? 'desc',
      showSortButton: overrides.showSortButton ?? true,
    }),
  );
}

function node(partial: Partial<FileTreeNode> & { name: string }): FileTreeNode {
  return {
    path: `/${partial.name}`,
    type: 'file',
    ...partial,
  };
}

describe('useFileExplorerSort', () => {
  describe('needsMetadata', () => {
    it('is true when the sort button is shown', () => {
      const { result } = setup({ showSortButton: true, defaultSortField: 'name' });
      expect(result.current.needsMetadata).toBe(true);
    });

    it('is true when default sort field is mtime even without the sort button', () => {
      const { result } = setup({ showSortButton: false, defaultSortField: 'mtime' });
      expect(result.current.needsMetadata).toBe(true);
    });

    it('is false when sorting by name without the sort button', () => {
      const { result } = setup({ showSortButton: false, defaultSortField: 'name' });
      expect(result.current.needsMetadata).toBe(false);
    });
  });

  describe('cycleSort', () => {
    it('cycles mtime desc -> mtime asc -> name asc -> name desc -> mtime desc', () => {
      const { result } = setup({ defaultSortField: 'mtime', defaultSortOrder: 'desc' });

      // mtime desc -> mtime asc
      act(() => result.current.cycleSort());
      expect(result.current.SortIcon).toBe(ClockArrowUp);
      expect(result.current.sortTooltip).toBe('Sorted by modified (oldest)');

      // mtime asc -> name asc
      act(() => result.current.cycleSort());
      expect(result.current.SortIcon).toBe(ArrowDownAZ);
      expect(result.current.sortTooltip).toBe('Sorted by name A\u2192Z');

      // name asc -> name desc
      act(() => result.current.cycleSort());
      expect(result.current.SortIcon).toBe(ArrowUpZA);
      expect(result.current.sortTooltip).toBe('Sorted by name Z\u2192A');

      // name desc -> mtime desc (fallback branch)
      act(() => result.current.cycleSort());
      expect(result.current.SortIcon).toBe(ClockArrowDown);
      expect(result.current.sortTooltip).toBe('Sorted by modified (newest)');
    });
  });

  describe('SortIcon and sortTooltip', () => {
    it('reflects the initial name ascending state', () => {
      const { result } = setup({ defaultSortField: 'name', defaultSortOrder: 'asc' });
      expect(result.current.SortIcon).toBe(ArrowDownAZ);
      expect(result.current.sortTooltip).toBe('Sorted by name A\u2192Z');
    });

    it('reflects the initial name descending state', () => {
      const { result } = setup({ defaultSortField: 'name', defaultSortOrder: 'desc' });
      expect(result.current.SortIcon).toBe(ArrowUpZA);
      expect(result.current.sortTooltip).toBe('Sorted by name Z\u2192A');
    });
  });

  describe('sortNodes', () => {
    it('keeps directories before files and sorts by mtime descending', () => {
      const { result } = setup({ defaultSortField: 'mtime', defaultSortOrder: 'desc' });
      const input: FileTreeNode[] = [
        node({ name: 'a.txt', mtime: 100 }),
        node({ name: 'dirOld', type: 'directory', mtime: 1 }),
        node({ name: 'b.txt', mtime: 300 }),
        node({ name: 'dirNew', type: 'directory', mtime: 5 }),
      ];
      const sorted = result.current.sortNodes(input);
      expect(sorted.map((n) => n.name)).toEqual(['dirNew', 'dirOld', 'b.txt', 'a.txt']);
    });

    it('sorts by mtime ascending and treats missing mtime as 0', () => {
      const { result } = setup({ defaultSortField: 'mtime', defaultSortOrder: 'asc' });
      const input: FileTreeNode[] = [
        node({ name: 'withTime', mtime: 50 }),
        node({ name: 'noTime' }),
      ];
      const sorted = result.current.sortNodes(input);
      expect(sorted.map((n) => n.name)).toEqual(['noTime', 'withTime']);
    });

    it('sorts by name ascending with natural numeric ordering', () => {
      const { result } = setup({ defaultSortField: 'name', defaultSortOrder: 'asc' });
      const input: FileTreeNode[] = [
        node({ name: 'file10.txt' }),
        node({ name: 'file2.txt' }),
        node({ name: 'file1.txt' }),
      ];
      const sorted = result.current.sortNodes(input);
      expect(sorted.map((n) => n.name)).toEqual(['file1.txt', 'file2.txt', 'file10.txt']);
    });

    it('sorts by name descending', () => {
      const { result } = setup({ defaultSortField: 'name', defaultSortOrder: 'desc' });
      const input: FileTreeNode[] = [
        node({ name: 'apple.txt' }),
        node({ name: 'cherry.txt' }),
        node({ name: 'banana.txt' }),
      ];
      const sorted = result.current.sortNodes(input);
      expect(sorted.map((n) => n.name)).toEqual(['cherry.txt', 'banana.txt', 'apple.txt']);
    });
  });
});
