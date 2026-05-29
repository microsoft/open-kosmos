import React, { useLayoutEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Import, Store } from 'lucide-react';
import { adjustAnchoredDropdownToViewport, AnchoredDropdownPosition } from '../../lib/utilities/dropdownPosition';
import { isCdnConfigured } from '@shared/utils/cdn';

interface McpAddMenuDropdownProps {
  mcpAddMenuRef: React.RefObject<HTMLDivElement>;
  position: AnchoredDropdownPosition;
  onClose: () => void;
}

const McpAddMenuDropdown: React.FC<McpAddMenuDropdownProps> = ({
  mcpAddMenuRef,
  position,
  onClose
}) => {
  const navigate = useNavigate();

  const handleNewServer = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    // Navigate to new server page
    navigate('/settings/mcp/new');
    onClose();
  };

  const handleImportFromVSCode = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    // Navigate to VS Code import page
    navigate('/settings/mcp/import-vscode');
    onClose();
  };

  const handleAddFromLibrary = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    // Navigate to MCP Library page
    navigate('/settings/mcp/mcp-library');
    onClose();
  };

  // 🔧 Fix: Adjust menu position if it overflows window bottom
  useLayoutEffect(() => {
    if (mcpAddMenuRef.current) {
      adjustAnchoredDropdownToViewport(mcpAddMenuRef.current, position);
    }
  }, [position]);

  return (
    <div
      ref={mcpAddMenuRef}
      className="dropdown-menu mcp-add-dropdown-menu"
      style={{
        top: `${position.top}px`,
        left: `${position.left}px`
      }}
      role="menu"
    >
      <button
        className="dropdown-menu-item"
        onClick={handleNewServer}
        role="menuitem"
      >
        <span className="dropdown-menu-item-icon"><Plus size={16} strokeWidth={1.5} /></span>
        <span className="dropdown-menu-item-text">New Server</span>
      </button>
      <button
        className="dropdown-menu-item"
        onClick={handleImportFromVSCode}
        role="menuitem"
      >
        <span className="dropdown-menu-item-icon"><Import size={16} strokeWidth={1.5} /></span>
        <span className="dropdown-menu-item-text">Import from VS Code</span>
      </button>
      {/* MCP Library is a CDN-backed optional feature; hide entry when no CDN is configured */}
      {isCdnConfigured() && (
      <button
        className="dropdown-menu-item"
        onClick={handleAddFromLibrary}
        role="menuitem"
      >
        <span className="dropdown-menu-item-icon"><Store size={16} strokeWidth={1.5} /></span>
        <span className="dropdown-menu-item-text">Add from MCP Library</span>
      </button>
      )}
    </div>
  );
};

export default McpAddMenuDropdown;