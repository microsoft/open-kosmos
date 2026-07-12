import { useCallback, useEffect, useRef } from 'react';
import { isValidWorkspacePath, startWatch, stopWatch, workspaceOps } from '../../../lib/chat/workspaceOps';

export function useWorkspaceRefreshWatcher(
  workspacePath: string,
  revealRequest: { path: string; nonce: number } | null | undefined,
  onRevealHandled: (() => void) | undefined,
  reloadRootTree: (path: string, options?: { clearAllCaches?: boolean }) => Promise<void>,
  handleLoadChildren: (dirPath: string) => Promise<void>,
) {
  const watchStartedRef = useRef(false);
  const fileChangeListenerRef = useRef<(() => void) | null>(null);

  const handleRefresh = useCallback(async () => {
    if (!isValidWorkspacePath(workspacePath)) return;
    const storageKey = `fileTree_expanded_${workspacePath}`;
    let prevExpanded: string[] = [];
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) prevExpanded = JSON.parse(saved) as string[];
    } catch { /* ignore */ }
    prevExpanded.sort((a, b) => a.split('/').length - b.split('/').length);
    await reloadRootTree(workspacePath, { clearAllCaches: true });
    for (const dirPath of prevExpanded) await handleLoadChildren(dirPath);
  }, [workspacePath, reloadRootTree, handleLoadChildren]);

  useEffect(() => {
    if (!revealRequest || revealRequest.path !== workspacePath) return;
    handleRefresh().finally(() => onRevealHandled?.());
  }, [handleRefresh, onRevealHandled, revealRequest, workspacePath]);

  const stopFileWatcher = useCallback(async () => {
    if (!watchStartedRef.current) return;
    try {
      fileChangeListenerRef.current?.();
      fileChangeListenerRef.current = null;
      await stopWatch();
      watchStartedRef.current = false;
    } catch { /* ignore */ }
  }, []);

  const startFileWatcher = useCallback(async (path: string) => {
    if (!path || !isValidWorkspacePath(path) || watchStartedRef.current) return;
    try {
      fileChangeListenerRef.current?.();
      fileChangeListenerRef.current = workspaceOps.onRefresh(handleRefresh);
      const result = await startWatch(path, {
        excludes: ['node_modules', '.git', 'dist', 'build', '.next', 'out', 'coverage', '.vscode', '.idea', '.DS_Store', 'Thumbs.db'],
      });
      if (result.success) watchStartedRef.current = true;
    } catch { /* ignore */ }
  }, [handleRefresh]);

  useEffect(() => {
    if (isValidWorkspacePath(workspacePath)) {
      stopFileWatcher().then(() => { void startFileWatcher(workspacePath); });
    } else {
      void stopFileWatcher();
    }
    return () => { void stopFileWatcher(); };
  }, [workspacePath, startFileWatcher, stopFileWatcher]);

  return { handleRefresh };
}
