import React, { useLayoutEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Import } from 'lucide-react';

interface McpAddMenuDropdownProps {
  mcpAddMenuRef: React.RefObject<HTMLDivElement>;
  position: { top: number; left: number };
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
    // Navigate to VSCode import page
    navigate('/settings/mcp/import-vscode');
    onClose();
  };

  // 🔧 Fix: Adjust menu position if it overflows window bottom
  useLayoutEffect(() => {
    if (mcpAddMenuRef.current) {
      const rect = mcpAddMenuRef.current.getBoundingClientRect();
      const windowHeight = window.innerHeight;
      const padding = 10;
      
      // Check if we have triggerTop info (passed via position prop extension)
      const triggerTop = (position as any).triggerTop;
      
      if (rect.bottom > windowHeight - padding) {
        // If it overflows bottom, try to position above the trigger
        if (triggerTop !== undefined) {
           const newTop = triggerTop - rect.height - 4;
           mcpAddMenuRef.current.style.top = `${Math.max(padding, newTop)}px`;
        } else {
           // Fallback to just shifting up if no trigger info
           const newTop = windowHeight - rect.height - padding;
           mcpAddMenuRef.current.style.top = `${Math.max(padding, newTop)}px`;
        }
      }
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
    </div>
  );
};

export default McpAddMenuDropdown;