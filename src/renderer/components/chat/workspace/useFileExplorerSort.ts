import { useState, useCallback, useMemo } from 'react';
import {
  ArrowDownAZ,
  ArrowUpZA,
  ClockArrowDown,
  ClockArrowUp,
} from 'lucide-react';
import type { FileTreeNode } from '../../../lib/chat/workspaceOps';

export type SortField = 'name' | 'mtime';
export type SortOrder = 'asc' | 'desc';

interface UseFileExplorerSortOptions {
  defaultSortField: SortField;
  defaultSortOrder: SortOrder;
  showSortButton: boolean;
}

/**
 * Sort state and helpers for `FileExplorerSection`. Owns the sort field/order,
 * exposes a cycle action, the indicator icon/tooltip, a directory-first
 * `sortNodes` comparator, and a `needsMetadata` flag indicating whether the
 * caller must request file metadata (mtime) from the workspace IPC.
 */
export function useFileExplorerSort({
  defaultSortField,
  defaultSortOrder,
  showSortButton,
}: UseFileExplorerSortOptions) {
  const [sortField, setSortField] = useState<SortField>(defaultSortField);
  const [sortOrder, setSortOrder] = useState<SortOrder>(defaultSortOrder);

  const needsMetadata = showSortButton || defaultSortField === 'mtime';

  // Cycle: Modified down -> Modified up -> Name up -> Name down -> Modified down
  const cycleSort = useCallback(() => {
    if (sortField === 'mtime' && sortOrder === 'desc') {
      setSortOrder('asc');
    } else if (sortField === 'mtime' && sortOrder === 'asc') {
      setSortField('name');
      setSortOrder('asc');
    } else if (sortField === 'name' && sortOrder === 'asc') {
      setSortOrder('desc');
    } else {
      setSortField('mtime');
      setSortOrder('desc');
    }
  }, [sortField, sortOrder]);

  const SortIcon = useMemo(() => {
    if (sortField === 'name') return sortOrder === 'asc' ? ArrowDownAZ : ArrowUpZA;
    return sortOrder === 'desc' ? ClockArrowDown : ClockArrowUp;
  }, [sortField, sortOrder]);

  const sortTooltip = useMemo(() => {
    if (sortField === 'name') {
      return sortOrder === 'asc' ? 'Sorted by name A\u2192Z' : 'Sorted by name Z\u2192A';
    }
    return sortOrder === 'desc' ? 'Sorted by modified (newest)' : 'Sorted by modified (oldest)';
  }, [sortField, sortOrder]);

  // Directories first, then files; both groups ordered by the active field.
  const sortNodes = useCallback(
    (nodes: FileTreeNode[]): FileTreeNode[] => {
      const dirs = nodes.filter((n) => n.type === 'directory');
      const files = nodes.filter((n) => n.type !== 'directory');

      const compare = (a: FileTreeNode, b: FileTreeNode): number => {
        if (sortField === 'mtime') {
          const aTime = a.mtime ?? 0;
          const bTime = b.mtime ?? 0;
          return sortOrder === 'asc' ? aTime - bTime : bTime - aTime;
        }
        const cmp = a.name.localeCompare(b.name, undefined, { numeric: true });
        return sortOrder === 'asc' ? cmp : -cmp;
      };

      return [...dirs.sort(compare), ...files.sort(compare)];
    },
    [sortField, sortOrder],
  );

  return {
    needsMetadata,
    cycleSort,
    SortIcon,
    sortTooltip,
    sortNodes,
  };
}
