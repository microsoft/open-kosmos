import React, { useLayoutEffect } from 'react';
import { FolderOpen, File, FolderPlus, Clipboard } from 'lucide-react';
import { WorkspaceMenuActions } from '../chat/workspace/WorkspaceExplorerSidepane';

interface WorkspaceMenuDropdownProps {
  workspaceMenuRef: React.RefObject<HTMLDivElement>;
  position: { top: number; left: number };
  actions: WorkspaceMenuActions;
  onClose: () => void;
}

const WorkspaceMenuDropdown: React.FC<WorkspaceMenuDropdownProps> = ({
  workspaceMenuRef,
  position,
  actions,
  onClose
}) => {
  // Get platform info
  const platform = window.electronAPI?.platform || 'darwin';
  const isMac = platform === 'darwin';
  const isWindows = platform === 'win32';

  // Determine menu text based on platform
  const getOpenInExplorerText = () => {
    if (isWindows) {
      return 'Open in File Explorer';
    } else if (isMac) {
      return 'Open in Finder';
    } else {
      return 'Open in File Manager';
    }
  };

  const handleOpenInExplorer = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    actions.onOpenInExplorer();
    onClose();
  };

  const handleAddFiles = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    actions.onAddFiles();
    onClose();
  };

  const handleAddFolder = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    actions.onAddFolder();
    onClose();
  };

  const handlePasteToWorkspace = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    actions.onPasteToWorkspace();
    onClose();
  };

  // 🔧 Fix: Adjust menu position if it overflows window bottom
  useLayoutEffect(() => {
    if (workspaceMenuRef.current) {
      const rect = workspaceMenuRef.current.getBoundingClientRect();
      const windowHeight = window.innerHeight;
      const padding = 10;
      
      // Check if we have triggerTop info (passed via position prop extension)
      const triggerTop = (position as any).triggerTop;
      
      if (rect.bottom > windowHeight - padding) {
        // If it overflows bottom, try to position above the trigger
        if (triggerTop !== undefined) {
           const newTop = triggerTop - rect.height - 4;
           workspaceMenuRef.current.style.top = `${Math.max(padding, newTop)}px`;
        } else {
           // Fallback to just shifting up if no trigger info
           const newTop = windowHeight - rect.height - padding;
           workspaceMenuRef.current.style.top = `${Math.max(padding, newTop)}px`;
        }
      }
    }
  }, [position]);

  return (
    <div
      ref={workspaceMenuRef}
      className="dropdown-menu workspace-dropdown-menu"
      style={{
        top: `${position.top}px`,
        left: `${position.left}px`
      }}
      role="menu"
    >
      {actions.canAddFiles && (
        <button
          className="dropdown-menu-item"
          onClick={handleAddFiles}
          role="menuitem"
        >
          <span className="dropdown-menu-item-icon"><File size={16} strokeWidth={1.5} /></span>
          <span className="dropdown-menu-item-text">Add Files</span>
        </button>
      )}
      {actions.canAddFolder && (
        <button
          className="dropdown-menu-item"
          onClick={handleAddFolder}
          role="menuitem"
        >
          <span className="dropdown-menu-item-icon"><FolderPlus size={16} strokeWidth={1.5} /></span>
          <span className="dropdown-menu-item-text">Add Folder</span>
        </button>
      )}
      {actions.canPasteToWorkspace && (
        <button
          className="dropdown-menu-item"
          onClick={handlePasteToWorkspace}
          role="menuitem"
        >
          <span className="dropdown-menu-item-icon"><Clipboard size={16} strokeWidth={1.5} /></span>
          <span className="dropdown-menu-item-text">Paste Text</span>
        </button>
      )}
      
      {/* Divider - only show if there are items above and below */}
      {(actions.canAddFiles || actions.canAddFolder || actions.canPasteToWorkspace) && 
       actions.canOpenInExplorer && (
        <div className="dropdown-menu-divider" />
      )}
      
      {actions.canOpenInExplorer && (
        <button
          className="dropdown-menu-item"
          onClick={handleOpenInExplorer}
          role="menuitem"
        >
          <span className="dropdown-menu-item-icon"><FolderOpen size={16} strokeWidth={1.5} /></span>
          <span className="dropdown-menu-item-text">{getOpenInExplorerText()}</span>
        </button>
      )}

    </div>
  );
};

export default WorkspaceMenuDropdown;
