import React, { useLayoutEffect, useRef, createElement } from 'react';
import { FolderOpen, File, FolderPlus, Clipboard, Copy } from 'lucide-react';
import { WorkspaceMenuActions } from '../chat/workspace/WorkspaceExplorerSidepane';
import { adjustAnchoredDropdownToViewport, ANCHORED_DROPDOWN_SIZE_PRESETS, AnchoredDropdownPosition, getAnchoredDropdownPosition } from '@/lib/utilities/dropdownPosition';
import { atom } from '@/atom';
import { useClickOut } from '../ui/use-click-out';

const zeroMenuState: {
  isOpen: boolean;
  position: AnchoredDropdownPosition | null;
  actions: WorkspaceMenuActions | null;
} = { isOpen: false, position: null, actions: null };

export const WorkspaceMenuAtom = atom(zeroMenuState, (get, set) => {
  function close() {
    set(zeroMenuState);
  }

  function toggle(buttonElement: HTMLElement, actions: WorkspaceMenuActions) {
    const prevState = get();
    // If the menu is already open, close it
    if (prevState.isOpen) {
      return set(zeroMenuState);
    }
    // Otherwise, open the menu
    const position = getAnchoredDropdownPosition(
      buttonElement,
      ANCHORED_DROPDOWN_SIZE_PRESETS.workspaceMenu,
    );
    set({ isOpen: true, position, actions });
  }

  return { toggle, close };
});

interface InnerProps {
  position: AnchoredDropdownPosition;
  actions: WorkspaceMenuActions;
}

const WorkspaceMenuDropdown: React.FC<InnerProps> = ({ position, actions }) => {
  const { close: onClose } = WorkspaceMenuAtom.useChange();
  const workspaceMenuRef = useRef<HTMLDivElement>(null);

  useClickOut(workspaceMenuRef, onClose);

  useLayoutEffect(() => {
    if (workspaceMenuRef.current) {
      adjustAnchoredDropdownToViewport(workspaceMenuRef.current, position);
    }
  }, [position]);

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

      {/* Copy Folder Path */}
      {actions.workspacePath && (
        <button
          className="dropdown-menu-item"
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            navigator.clipboard.writeText(actions.workspacePath);
            onClose();
          }}
          role="menuitem"
        >
          <span className="dropdown-menu-item-icon"><Copy size={16} strokeWidth={1.5} /></span>
          <span className="dropdown-menu-item-text">Copy Path</span>
        </button>
      )}

    </div>
  );
};

export default () => {
  const [{ isOpen, position, actions }] = WorkspaceMenuAtom.use();
  if (!isOpen || !position || !actions) return null;
  return createElement(WorkspaceMenuDropdown, { position, actions });
};
