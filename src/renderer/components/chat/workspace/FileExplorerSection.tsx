import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { RefreshCw, FolderOpen, MoreHorizontal, File, FolderPlus, Clipboard, ChevronDown, ChevronRight } from 'lucide-react';
import {
  isValidWorkspacePath,
  copyPathToWorkspace,
  copyPathsToWorkspace,
  openInSystemExplorer,
  FileTreeNode,
} from '../../../lib/chat/workspaceOps';
import FileTreeExplorer from './FileTreeExplorer';
import { usePasteToWorkspace } from './PasteToWorkspaceProvider';
import { WorkspaceMenuActions } from './WorkspaceExplorerSidepane';
import { useFileExplorerSort, type SortField, type SortOrder } from './useFileExplorerSort';
import { useWorkspaceFileTree } from './useWorkspaceFileTree';
import { useWorkspaceRefreshWatcher } from './useWorkspaceRefreshWatcher';
import { useI18n } from '../../../lib/i18n/useI18n';

export type { SortField, SortOrder };

// Image file extensions set
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'bmp', 'webp', 'ico', 'tiff', 'tif']);
const isImageFile = (filename: string): boolean => {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  return IMAGE_EXTENSIONS.has(ext);
};

interface FileExplorerSectionProps {
  title: string;
  sectionClassName: string;
  currentPath: string;
  defaultPath: string;
  currentChatId: string | null;
  revealRequest?: {
    path: string;
    nonce: number;
  } | null;
  onRevealHandled?: () => void;
  onUpdatePath: (path: string) => Promise<void>;
  onMenuToggle?: (buttonElement: HTMLElement, menuActions: WorkspaceMenuActions) => void;
  /** Custom message shown when the directory is empty */
  emptyMessage?: string;
  /** Hide action buttons (Add Files, Add Folder, Paste) in empty state */
  hideEmptyActions?: boolean;
  /** Default sort field. Defaults to 'name'. */
  defaultSortField?: SortField;
  /** Default sort order. Defaults to 'asc'. */
  defaultSortOrder?: SortOrder;
  /** Show the sort toggle button. Defaults to false. */
  showSortButton?: boolean;
}

const FileExplorerSection: React.FC<FileExplorerSectionProps> = ({
  title,
  sectionClassName,
  currentPath,
  defaultPath,
  currentChatId,
  revealRequest,
  onRevealHandled,
  onUpdatePath,
  onMenuToggle,
  emptyMessage,
  hideEmptyActions,
  defaultSortField = 'name',
  defaultSortOrder = 'asc',
  showSortButton = false,
}) => {
  const { t } = useI18n();
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Sort state (encapsulated in a custom hook to keep this component focused).
  const { needsMetadata, cycleSort, SortIcon, sortTooltip, sortNodes } = useFileExplorerSort({
    defaultSortField,
    defaultSortOrder,
    showSortButton,
  });

  // Paste to Workspace - using global context
  const { openPasteDialog } = usePasteToWorkspace();

  // Current browsing directory path stack
  const [directoryStack, setDirectoryStack] = useState<FileTreeNode[]>([]);

  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const { workspacePath, fileTree, isLoading, setFileTree, handleLoadChildren, isChildrenLoaded, reloadRootTree } = useWorkspaceFileTree(currentPath, needsMetadata);
  const { handleRefresh } = useWorkspaceRefreshWatcher(workspacePath, revealRequest, onRevealHandled, reloadRootTree, handleLoadChildren);

  useEffect(() => {
    if (revealRequest?.path === workspacePath) setIsCollapsed(false);
  }, [revealRequest, workspacePath]);



  // Open in system file explorer
  const handleOpenInExplorer = useCallback(async (event?: React.MouseEvent) => {
    event?.stopPropagation();
    if (!isValidWorkspacePath(workspacePath)) return;
    try {
      await openInSystemExplorer(workspacePath);
    } catch (error) { /* ignore */ }
  }, [workspacePath]);



  // Handle file click
  const handleFileClick = useCallback((node: FileTreeNode) => {
    if (isImageFile(node.name)) {
      window.dispatchEvent(new CustomEvent('imageViewer:open', {
        detail: {
          images: [{ id: node.path, url: `file://${node.path}`, alt: node.name }],
          initialIndex: 0,
        },
      }));
    } else {
      window.dispatchEvent(new CustomEvent('fileViewer:open', {
        detail: {
          file: { name: node.name, url: node.path },
          origin: 'tree',
        },
      }));
    }
  }, []);

  // Drag and drop handling
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);

    if (!isValidWorkspacePath(workspacePath)) return;

    const files = e.dataTransfer.files;
    if (files.length === 0) return;

    const sourcePaths: string[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      let sourcePath: string | undefined;

      if (window.electronAPI?.fs?.getPathForFile) {
        try {
          sourcePath = window.electronAPI.fs.getPathForFile(file);
        } catch (err) { /* ignore */ }
      }
      if (!sourcePath && (file as any).path) {
        sourcePath = (file as any).path;
      }
      if (!sourcePath) continue;

      sourcePaths.push(sourcePath);
    }

    if (sourcePaths.length === 0) return;

    let successCount = 0;
    try {
      const result = await copyPathsToWorkspace(sourcePaths, workspacePath, {
        conflictResolution: 'prompt',
      });
      successCount = result.data?.successCount ?? 0;
    } catch (error) { /* ignore */ }

    if (successCount > 0) {
      try {
        await reloadRootTree(workspacePath);
      } catch (error) { /* ignore */ }
    }
  }, [workspacePath, reloadRootTree]);

  // Build file tree (with path safety validation and sorting)
  const fileTreeWithRoot = useMemo(() => {
    if (!isValidWorkspacePath(workspacePath)) return [];

    const filterValidNodes = (nodes: FileTreeNode[]): FileTreeNode[] => {
      return nodes.filter(node => {
        if (!node.path || !node.path.startsWith(workspacePath)) return false;
        if (node.children) {
          node.children = filterValidNodes(node.children);
        }
        return true;
      });
    };

    const validatedFileTree = fileTree.length > 0 ? filterValidNodes(fileTree) : [];

    // Apply client-side sorting (directories first, then within-group ordering).
    return sortNodes(validatedFileTree);
  }, [workspacePath, fileTree, sortNodes]);

  // Check if empty
  const isEmpty = useMemo(() => {
    return isValidWorkspacePath(workspacePath) && fileTree.length === 0;
  }, [workspacePath, fileTree]);

  // Handle add files
  const handleAddFiles = useCallback(async () => {
    if (!isValidWorkspacePath(workspacePath)) return;

    try {
      const result = await window.electronAPI?.fs?.selectFiles?.({
        title: t('workspace.explorer.selectFilesTitle'),
        allowMultiple: true,
      });

      if (!result?.success || !result.filePaths || result.filePaths.length === 0) return;

      let successCount = 0;
      try {
        const copyResult = await copyPathsToWorkspace(result.filePaths, workspacePath, {
          conflictResolution: 'prompt',
        });
        successCount = copyResult.data?.successCount ?? 0;
      } catch (error) { /* ignore */ }

      if (successCount > 0) {
        try {
          await reloadRootTree(workspacePath);
        } catch (error) { /* ignore */ }
      }
    } catch (error) { /* ignore */ }
  }, [workspacePath, reloadRootTree, t]);

  // Handle add folder
  const handleAddFolder = useCallback(async () => {
    if (!isValidWorkspacePath(workspacePath)) return;

    try {
      const result = await window.electronAPI?.workspace?.selectFolder?.();
      if (!result?.success || !result.folderPath) return;

      const copyResult = await copyPathToWorkspace(result.folderPath, workspacePath, {
        conflictResolution: 'prompt',
      });
      if (copyResult.success) {
        try {
          await reloadRootTree(workspacePath);
        } catch (error) { /* ignore */ }
      }
    } catch (error) { /* ignore */ }
  }, [workspacePath, reloadRootTree]);

  // Handle paste
  const handleOpenPasteDialog = useCallback(() => {
    if (!isValidWorkspacePath(workspacePath)) return;
    openPasteDialog(workspacePath, workspacePath, () => {
      void reloadRootTree(workspacePath);
    });
  }, [workspacePath, openPasteDialog, reloadRootTree]);

  // Handle menu toggle
  const handleMenuToggle = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();

    if (menuButtonRef.current && onMenuToggle) {
      const menuActions: WorkspaceMenuActions = {
        onOpenInExplorer: handleOpenInExplorer,
        onAddFiles: handleAddFiles,
        onAddFolder: handleAddFolder,
        onPasteToWorkspace: handleOpenPasteDialog,
        canOpenInExplorer: isValidWorkspacePath(workspacePath),
        canAddFiles: isValidWorkspacePath(workspacePath),
        canAddFolder: isValidWorkspacePath(workspacePath),
        canPasteToWorkspace: isValidWorkspacePath(workspacePath),
        workspacePath,
      };

      onMenuToggle(menuButtonRef.current, menuActions);
    }
  }, [onMenuToggle, workspacePath, handleOpenInExplorer, handleAddFiles, handleAddFolder, handleOpenPasteDialog, currentChatId]);

  // Get empty state message
  const getEmptyStateMessage = useCallback(() => {
    return {
      title: t('workspace.explorer.defaultEmptyTitle'),
      subtitle: t('workspace.explorer.emptySubtitle'),
    };
  }, [t]);

  // Toggle collapse state
  const handleToggleCollapse = useCallback(() => {
    setIsCollapsed(prev => !prev);
  }, []);

  // Auto-restore expanded directory content (on first load/sidepane remount)
  useEffect(() => {
    if (!isLoading && fileTree.length > 0 && isValidWorkspacePath(workspacePath)) {
      const storageKey = `fileTree_expanded_${workspacePath}`;
      let prevExpanded: string[] = [];
      try {
        const saved = localStorage.getItem(storageKey);
        if (saved) prevExpanded = JSON.parse(saved) as string[];
      } catch { /* ignore */ }
      prevExpanded.sort((a, b) => a.split('/').length - b.split('/').length);
      // Only load expanded directories not yet cached
      prevExpanded.forEach(dirPath => {
        if (!isChildrenLoaded(dirPath)) {
          handleLoadChildren(dirPath);
        }
      });
    }
  }, [fileTree, workspacePath, isLoading, isChildrenLoaded, handleLoadChildren]);

  return (
    <div
      className={`${sectionClassName} file-explorer-section ${isDraggingOver ? 'dragging-over' : ''} ${isCollapsed ? 'collapsed' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Section Header */}
      <div className="sidepane-section-header" onClick={handleToggleCollapse}>
        <div className="sidepane-section-header-title">
          <span className="sidepane-section-collapse-icon">
            {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          </span>
          <span className="sidepane-section-title-text">{title}</span>
        </div>
        <div className="sidepane-section-header-actions" onClick={(e) => e.stopPropagation()}>
          {!isCollapsed && showSortButton && isValidWorkspacePath(workspacePath) && fileTree.length > 0 && (
            <button
              className="sidepane-action-btn"
              onClick={cycleSort}
              title={sortTooltip}
            >
              <SortIcon size={14} />
            </button>
          )}
          {!isCollapsed && isValidWorkspacePath(workspacePath) && (
            <button
              className="sidepane-action-btn"
              onClick={handleRefresh}
              disabled={isLoading}
              title={t('workspace.explorer.refreshFileTree', { title })}
            >
              <RefreshCw size={14} />
            </button>
          )}

          {!isCollapsed && (
            <button
              ref={menuButtonRef}
              className="sidepane-action-btn"
              onClick={handleMenuToggle}
              disabled={!currentChatId}
              title={t('common.moreOptions')}
            >
              <MoreHorizontal size={14} />
            </button>
          )}

        </div>
      </div>

      {/* Section Body */}
      {!isCollapsed && (
        <div className="sidepane-section-body">
          {isDraggingOver && (
            <div className="drop-overlay">
              <div className="drop-overlay-content">
                <div className="drop-icon">📁</div>
                <p>{t('workspace.explorer.dropToCopy', { title })}</p>
              </div>
            </div>
          )}
          {isLoading ? (
            <div className="loading-state">
              <div className="loading-spinner">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <g clipPath="url(#clip0_section)">
                    <circle cx="10" cy="10" r="9" stroke="black" strokeOpacity="0.15" strokeWidth="2"/>
                    <path d="M19 10C19 12.3869 18.0518 14.6761 16.364 16.364C14.6761 18.0518 12.387 19 10 19" stroke="var(--color-warm-900)" strokeWidth="2" strokeLinecap="round"/>
                  </g>
                  <defs>
                    <clipPath id="clip0_section">
                      <rect width="20" height="20" fill="white"/>
                    </clipPath>
                  </defs>
                </svg>
              </div>
              <p>{t('workspace.explorer.loadingTitle', { title })}</p>
            </div>
          ) : !isValidWorkspacePath(workspacePath) ? (
            <div className="empty-state">
              <div className="empty-icon">📂</div>
              <p>{t('workspace.explorer.defaultForChat', { title })}</p>
              <small style={{ fontSize: '0.85em', color: 'var(--color-warm-400)', marginTop: '8px', display: 'block' }}>
                {t('common.path')}: {workspacePath || t('common.notInitialized')}
              </small>
            </div>
          ) : isEmpty ? (
            <div className="sidepane-workspace-empty-state">
              <div className="sidepane-workspace-empty-content">
                <div className="sidepane-workspace-empty-icon">
                  <FolderOpen size={48} />
                </div>
                <p className="sidepane-workspace-empty-text">{emptyMessage || getEmptyStateMessage().title}</p>
                {!emptyMessage && <p className="sidepane-workspace-empty-subtext">{getEmptyStateMessage().subtitle}</p>}
                {!hideEmptyActions && (
                  <div className="sidepane-workspace-empty-actions">
                    <button className="sidepane-workspace-empty-btn primary" onClick={handleAddFiles}>
                      <File size={16} />
                      <span>{t('workspace.explorer.addFiles')}</span>
                    </button>
                    <button className="sidepane-workspace-empty-btn secondary" onClick={handleAddFolder}>
                      <FolderPlus size={16} />
                      <span>{t('workspace.explorer.addFolder')}</span>
                    </button>
                    <button className="sidepane-workspace-empty-btn secondary" onClick={handleOpenPasteDialog}>
                      <Clipboard size={16} />
                      <span>{t('workspace.explorer.pasteText')}</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <FileTreeExplorer
              nodes={fileTreeWithRoot}
              workspacePath={workspacePath}
              onFileClick={handleFileClick}
              className="workspace-file-tree"
              directoryStack={directoryStack}
              onDirectoryStackChange={setDirectoryStack}
              showBreadcrumb={false}
              onLoadChildren={handleLoadChildren}
            />
          )}
        </div>
      )}

    </div>
  );
};

export default FileExplorerSection;
