import React, { useLayoutEffect } from 'react';
import { FolderOpen, ExternalLink, Trash2, Copy, Download, ArrowRightToLine } from 'lucide-react';

interface FileTreeNodeContextMenuProps {
  fileTreeNodeMenuRef: React.RefObject<HTMLDivElement>;
  node: any;
  workspacePath: string;
  position: { top: number; left: number };
  onClose: () => void;
  onDelete?: (path: string) => void;
  onInstallSkill?: (filePath: string) => void;
  onMoveToKnowledge?: (filePath: string) => void;
  knowledgeBasePath?: string;
}

const FileTreeNodeContextMenu: React.FC<FileTreeNodeContextMenuProps> = ({
  fileTreeNodeMenuRef,
  node,
  workspacePath,
  position,
  onClose,
  onDelete,
  onInstallSkill,
  onMoveToKnowledge,
  knowledgeBasePath
}) => {
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
        console.error('[FileTreeNode] Failed to open file:', result?.error);
      }
    } catch (error) {
      console.error('[FileTreeNode] Error opening file:', error);
    }
    onClose();
  }, [fullPath, onClose]);

  // 🔧 Fix: Adjust menu position if it overflows window bottom
  useLayoutEffect(() => {
    if (fileTreeNodeMenuRef.current) {
      const rect = fileTreeNodeMenuRef.current.getBoundingClientRect();
      const windowHeight = window.innerHeight;
      const padding = 10;
      
      if (rect.bottom > windowHeight - padding) {
        const newTop = windowHeight - rect.height - padding;
        fileTreeNodeMenuRef.current.style.top = `${Math.max(padding, newTop)}px`;
      }
    }
  }, [position]);

  // Handle reveal in file explorer
  const handleShowInFolder = React.useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    try {
      if (!window.electronAPI?.workspace?.showInFolder) {
        return;
      }
      const result = await window.electronAPI.workspace.showInFolder(fullPath);
      if (!result?.success) {
        console.error('[FileTreeNode] Failed to show in folder:', result?.error);
      }
    } catch (error) {
      console.error('[FileTreeNode] Error showing in folder:', error);
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
        console.error('[FileTreeNode] Delete API not available');
        window.alert(`Failed to delete ${itemType}: Delete API not available`);
        onClose();
        return;
      }
      
      console.log('[FileTreeNode] Deleting path:', fullPath);
      const result = await window.electronAPI.fs.deletePaths([fullPath]);
      console.log('[FileTreeNode] Delete result:', result);
      
      if (!result?.success) {
        // Check specific error message
        let errorMsg = result?.error || 'Unknown error';
        if (result?.results && result.results.length > 0) {
          const failedResult = result.results.find((r: any) => !r.success);
          if (failedResult?.error) {
            errorMsg = failedResult.error;
          }
        }
        console.error('[FileTreeNode] Failed to delete:', errorMsg);
        window.alert(`Failed to delete ${itemType}: ${errorMsg}`);
      } else {
        // Notify parent component to refresh
        if (onDelete) {
          onDelete(fullPath);
        }
      }
    } catch (error) {
      console.error('[FileTreeNode] Error deleting:', error);
      window.alert(`Failed to delete ${itemType}: ${error instanceof Error ? error.message : String(error)}`);
    }
    onClose();
  }, [fullPath, node, onClose, onDelete]);

  // Copy path to clipboard
  const handleCopyPath = React.useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    try {
      await navigator.clipboard.writeText(fullPath);
    } catch (error) {
      console.error('[FileTreeNode] Failed to copy path:', error);
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

      {/* Move to Agent Knowledge - only for files NOT already in the knowledge base section */}
      {node.type === 'file' && onMoveToKnowledge && knowledgeBasePath && workspacePath !== knowledgeBasePath && (
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

      {/* Install Skill - only for .skill files */}
      {node.type === 'file' && node.name?.toLowerCase().endsWith('.skill') && onInstallSkill && (
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

export default FileTreeNodeContextMenu;