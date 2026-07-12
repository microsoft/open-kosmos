import { useCallback, useEffect, useRef, useState } from 'react';
import {
  clearFileTreeCache,
  FileTreeData,
  FileTreeNode,
  getDirectoryChildren,
  getWorkspaceFileTree,
  isValidWorkspacePath,
} from '../../../lib/chat/workspaceOps';

export const WORKSPACE_IGNORE_PATTERNS = [
  'node_modules', '.git', 'dist', 'build', '.next',
  'out', 'coverage', '.vscode', '.idea',
];

export function useWorkspaceFileTree(currentPath: string, needsMetadata: boolean) {
  const [workspacePath, setWorkspacePath] = useState('');
  const [fileTree, setFileTree] = useState<FileTreeNode[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const childrenCache = useRef<Map<string, true>>(new Map());

  const injectChildren = useCallback((nodes: FileTreeNode[], dirPath: string, children: FileTreeNode[]): FileTreeNode[] =>
    nodes.map((node) => {
      if (node.path === dirPath) return { ...node, children };
      if (node.type === 'directory' && node.children) return { ...node, children: injectChildren(node.children, dirPath, children) };
      return node;
    }), []);

  const handleLoadChildren = useCallback(async (dirPath: string) => {
    if (childrenCache.current.has(dirPath)) return;
    try {
      const result = await getDirectoryChildren(dirPath, { ignorePatterns: WORKSPACE_IGNORE_PATTERNS, includeMetadata: needsMetadata });
      const children = result.success ? (result.data?.children as FileTreeNode[] || []) : [];
      childrenCache.current.set(dirPath, true);
      setFileTree((prev) => injectChildren(prev, dirPath, children));
    } catch { /* ignore */ }
  }, [injectChildren, needsMetadata]);

  const isChildrenLoaded = useCallback((dirPath: string) => childrenCache.current.has(dirPath), []);

  const loadFileTree = useCallback(async (path: string) => {
    if (!path.trim()) {
      setFileTree([]);
      return;
    }
    setIsLoading(true);
    try {
      const result = await getWorkspaceFileTree(path, { maxDepth: 1, ignorePatterns: WORKSPACE_IGNORE_PATTERNS, includeMetadata: needsMetadata });
      if (!result.success) throw new Error(result.error || 'Failed to load file tree');
      setFileTree(((result.data as FileTreeData).tree) || []);
    } catch {
      setFileTree([]);
    } finally {
      setIsLoading(false);
    }
  }, [needsMetadata]);

  const reloadRootTree = useCallback(async (path: string, options?: { clearAllCaches?: boolean }) => {
    childrenCache.current.clear();
    try {
      await (options?.clearAllCaches ? clearFileTreeCache() : clearFileTreeCache(path));
    } catch { /* ignore */ }
    await loadFileTree(path);
  }, [loadFileTree]);

  useEffect(() => {
    if (currentPath !== workspacePath) setWorkspacePath(currentPath);
  }, [currentPath, workspacePath]);

  useEffect(() => {
    if (isValidWorkspacePath(workspacePath)) {
      void reloadRootTree(workspacePath);
    } else {
      childrenCache.current.clear();
      setFileTree([]);
    }
  }, [workspacePath, reloadRootTree]);

  return { workspacePath, fileTree, isLoading, setFileTree, handleLoadChildren, isChildrenLoaded, reloadRootTree };
}
