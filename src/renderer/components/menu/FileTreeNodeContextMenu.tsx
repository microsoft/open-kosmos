import React, { useLayoutEffect, useRef, createElement } from 'react';
import { FolderOpen, ExternalLink, Trash2, Copy, Download, ArrowRightToLine } from 'lucide-react';
import { CurrentSessionStatus } from '../../lib/chat/agentChatSessionCacheManager';
import { shouldShowMoveToKnowledgeBaseOption } from '../../lib/chat/moveToKnowledgeBase';
import { clampMenuToViewport, CONTEXT_MENU_SIZE_PRESETS, ContextMenuPosition, getContextMenuPosition } from '../../lib/utilities/dropdownPosition';
import { isInstallableSkillArtifact } from '../../lib/skills/installableSkillArtifacts';
import { atom } from '@/atom';
import { useClickOut } from '../ui/use-click-out';
import { createLogger } from '../../lib/utilities/logger';
import { workspaceOps } from '@renderer/lib/chat/workspaceOps';
const logger = createLogger('[FileTreeNodeContextMenu]');

const zeroState: {
  isOpen: boolean;
  position: ContextMenuPosition | null;
  node: any | null;
  workspacePath: string | null;
} = { isOpen: false, position: null, node: null, workspacePath: null };

export const FileTreeNodeMenuAtom = atom(zeroState, (get, set) => {
  function close() {
    set(zeroState);
  }

  function open(clientX: number, clientY: number, node: any, workspacePath: string) {
    const position = getContextMenuPosition(
      clientX,
      clientY,
      CONTEXT_MENU_SIZE_PRESETS.fileTreeNodeMenu,
    );
    set({ isOpen: true, position, node, workspacePath });
  }

  async function remove() {
    const { workspacePath } = get();
    // Clear cache to ensure reload on next fetch
    if (workspacePath) {
      await workspaceOps.clearFileTreeCache(workspacePath);
    }
    // Actively notify all FileExplorerSections to refresh, without relying on file watcher auto-detection
    workspaceOps.triggerRefresh();
  }

  return { open, close, remove };
});

interface MenuProps {
  onInstallSkill?: (filePath: string) => void;
  onMoveToKnowledge?: (filePath: string) => void;
  knowledgeBasePath?: string;
}

interface InnerProps extends MenuProps {
  position: ContextMenuPosition;
  node: any;
  workspacePath: string;
}

const FileTreeNodeContextMenu: React.FC<InnerProps> = ({
  onInstallSkill,
  onMoveToKnowledge,
  knowledgeBasePath,
  position,
  node,
  workspacePath,
}) => {
  const { close: onClose, remove: onRemove } = FileTreeNodeMenuAtom.useChange();
  const fileTreeNodeMenuRef = useRef<HTMLDivElement>(null);
  const { chatStatus } = CurrentSessionStatus.use();

  useClickOut(fileTreeNodeMenuRef, onClose);

  // Get platform info
  const platform = window.electronAPI?.platform || 'darwin';
  const isMac = platform === 'darwin';
  const isWindows = platform === 'win32';

  // node.path is already an absolute path (returned by FileTreeService), use directly
  const fullPath = node.path;

  // Handle opening file
  const handleOpen = React.useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    try {
      if (!window.electronAPI?.workspace?.openPath) {
        return;
      }
      const result = await window.electronAPI.workspace.openPath(fullPath);
      if (!result?.success) {
        logger.error('[FileTreeNode] Failed to open file:', result?.error);
      }
    } catch (error) {
      logger.error('[FileTreeNode] Error opening file:', error);
    }
    onClose();
  }, [fullPath, onClose]);

  // 🔧 Fix: Adjust menu position if it overflows any window edge (top, bottom, left, right)
  useLayoutEffect(() => {
    if (fileTreeNodeMenuRef.current) {
      clampMenuToViewport(fileTreeNodeMenuRef.current);
    }
  }, [position]);

  // Handle show in folder
  const handleShowInFolder = React.useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    try {
      if (!window.electronAPI?.workspace?.showInFolder) {
        return;
      }
      const result = await window.electronAPI.workspace.showInFolder(fullPath);
      if (!result?.success) {
        logger.error('[FileTreeNode] Failed to show in folder:', result?.error);
      }
    } catch (error) {
      logger.error('[FileTreeNode] Error showing in folder:', error);
    }
    onClose();
  }, [fullPath, onClose]);

  // Handle delete
  const handleDelete = React.useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    const itemName = node.name || fullPath.split(/[/\\]/).pop();
    const itemType = node.type === 'directory' ? 'folder' : 'file';

    // Use system confirmation dialog
    const confirmMessage = `Are you sure you want to delete this ${itemType}?\n\n${itemName}\n\nThis action cannot be undone.`;
    const confirmed = window.confirm(confirmMessage);

    if (!confirmed) {
      onClose();
      return;
    }

    try {
      if (!window.electronAPI?.fs?.deletePaths) {
        logger.error('[FileTreeNode] Delete API not available');
        window.alert(`Failed to delete ${itemType}: Delete API not available`);
        onClose();
        return;
      }

      logger.debug('[FileTreeNode] Deleting path:', fullPath);
      const result = await window.electronAPI.fs.deletePaths([fullPath]);
      logger.debug('[FileTreeNode] Delete result:', result);

      if (!result?.success) {
        // Check specific error message
        let errorMsg = result?.error || 'Unknown error';
        if (result?.results && result.results.length > 0) {
          const failedResult = result.results.find((r: any) => !r.success);
          if (failedResult?.error) {
            errorMsg = failedResult.error;
          }
        }
        logger.error('[FileTreeNode] Failed to delete:', errorMsg);
        window.alert(`Failed to delete ${itemType}: ${errorMsg}`);
      } else {
        // Notify parent component to refresh
        onRemove();
      }
    } catch (error) {
      logger.error('[FileTreeNode] Error deleting:', error);
      window.alert(`Failed to delete ${itemType}: ${error instanceof Error ? error.message : String(error)}`);
    }
    onClose();
  }, [fullPath, node, onClose]);

  // Copy path to clipboard
  const handleCopyPath = React.useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    try {
      await navigator.clipboard.writeText(fullPath);
    } catch (error) {
      logger.error('[FileTreeNode] Failed to copy path:', error);
    }
    onClose();
  }, [fullPath, onClose]);

  // Determine "Reveal in Folder" menu text based on platform
  const getRevealInFolderText = () => {
    if (isWindows) {
      return 'Reveal in File Explorer';
    } else if (isMac) {
      return 'Reveal in Finder';
    } else {
      return 'Reveal in File Manager';
    }
  };

  // Determine "Open" menu text based on platform and node type
  const getOpenMenuText = () => {
    if (node.type === 'file') {
      return 'Open with Default App';
    } else {
      // Directory node
      if (isWindows) {
        return 'Open in File Explorer';
      } else if (isMac) {
        return 'Open in Finder';
      } else {
        return 'Open in File Manager';
      }
    }
  };

  return (
    <div
      ref={fileTreeNodeMenuRef}
      className="dropdown-menu file-tree-node-context-menu"
      style={{
        top: `${position.top}px`,
        left: `${position.left}px`
      }}
      role="menu"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Open / Open in Folder */}
      {node.type === 'file' ? (
        <button
          className="dropdown-menu-item"
          onClick={handleOpen}
          role="menuitem"
        >
          <span className="dropdown-menu-item-icon">
            <ExternalLink size={16} strokeWidth={1.5} />
          </span>
          <span className="dropdown-menu-item-text">{getOpenMenuText()}</span>
        </button>
      ) : (
        <button
          className="dropdown-menu-item"
          onClick={handleShowInFolder}
          role="menuitem"
        >
          <span className="dropdown-menu-item-icon">
            <FolderOpen size={16} strokeWidth={1.5} />
          </span>
          <span className="dropdown-menu-item-text">{getOpenMenuText()}</span>
        </button>
      )}

      {/* Reveal in Finder/File Explorer - shown for files */}
      {node.type === 'file' && (
        <button
          className="dropdown-menu-item"
          onClick={handleShowInFolder}
          role="menuitem"
        >
          <span className="dropdown-menu-item-icon">
            <FolderOpen size={16} strokeWidth={1.5} />
          </span>
          <span className="dropdown-menu-item-text">{getRevealInFolderText()}</span>
        </button>
      )}

      {/* Copy Path */}
      <button
        className="dropdown-menu-item"
        onClick={handleCopyPath}
        role="menuitem"
      >
        <span className="dropdown-menu-item-icon">
          <Copy size={16} strokeWidth={1.5} />
        </span>
        <span className="dropdown-menu-item-text">Copy Path</span>
      </button>

      {/* Move to Agent Knowledge - only for files NOT already in the knowledge base section, and only when session is idle */}
      {node.type === 'file' && onMoveToKnowledge && workspacePath !== knowledgeBasePath && shouldShowMoveToKnowledgeBaseOption(fullPath, knowledgeBasePath, !chatStatus || chatStatus === 'idle') && (
        <>
          <div className="dropdown-menu-divider" />
          <button
            className="dropdown-menu-item"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onMoveToKnowledge(fullPath);
              onClose();
            }}
            role="menuitem"
          >
            <span className="dropdown-menu-item-icon">
              <ArrowRightToLine size={16} strokeWidth={1.5} />
            </span>
            <span className="dropdown-menu-item-text">Move to Agent Knowledge</span>
          </button>
        </>
      )}

      {/* Install Skill */}
      {node.type === 'file' && isInstallableSkillArtifact(fullPath) && onInstallSkill && (
        <>
          <div className="dropdown-menu-divider" />
          <button
            className="dropdown-menu-item"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onInstallSkill(fullPath);
              onClose();
            }}
            role="menuitem"
          >
            <span className="dropdown-menu-item-icon">
              <Download size={16} strokeWidth={1.5} />
            </span>
            <span className="dropdown-menu-item-text">Install skill</span>
          </button>
        </>
      )}

      {/* Divider */}
      <div className="dropdown-menu-divider" />

      {/* Delete */}
      <button
        className="dropdown-menu-item dropdown-menu-item-danger"
        onClick={handleDelete}
        role="menuitem"
      >
        <span className="dropdown-menu-item-icon">
          <Trash2 size={16} strokeWidth={1.5} />
        </span>
        <span className="dropdown-menu-item-text">Delete</span>
      </button>
    </div>
  );
};

export default (props: MenuProps) => {
  const [{ isOpen, position, node, workspacePath }] = FileTreeNodeMenuAtom.use();
  if (!isOpen || !position || !node || !workspacePath) return null;
  return createElement(FileTreeNodeContextMenu, { ...props, position, node, workspacePath });
};
