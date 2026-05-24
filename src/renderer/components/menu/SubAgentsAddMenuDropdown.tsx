import React, { useLayoutEffect } from 'react';
import { Plus, Upload } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { adjustAnchoredDropdownToViewport, AnchoredDropdownPosition } from '../../lib/utilities/dropdownPosition';

interface SubAgentsAddMenuDropdownProps {
  subAgentsAddMenuRef: React.RefObject<HTMLDivElement>;
  position: AnchoredDropdownPosition;
  onClose: () => void;
}

const SubAgentsAddMenuDropdown: React.FC<SubAgentsAddMenuDropdownProps> = ({
  subAgentsAddMenuRef,
  position,
  onClose,
}) => {
  const navigate = useNavigate();

  const handleImportFromClaudeCode = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    window.dispatchEvent(new CustomEvent('subAgents:importFromClaudeCode'));
    onClose();
  };

  const handleCreateCustom = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    navigate('/settings/sub-agents/new');
    onClose();
  };

  // Adjust menu position if it overflows window bottom or right edge
  useLayoutEffect(() => {
    if (subAgentsAddMenuRef.current) {
      adjustAnchoredDropdownToViewport(subAgentsAddMenuRef.current, position);
    }
  }, [position]);

  return (
    <div
      ref={subAgentsAddMenuRef}
      className="dropdown-menu skills-add-dropdown-menu"
      style={{
        top: `${position.top}px`,
        left: `${position.left}px`,
      }}
      role="menu"
    >
      <button
        className="dropdown-menu-item"
        onClick={handleCreateCustom}
        role="menuitem"
      >
        <span className="dropdown-menu-item-icon"><Plus size={16} strokeWidth={1.5} /></span>
        <span className="dropdown-menu-item-text">Create Custom</span>
      </button>
      <button
        className="dropdown-menu-item"
        onClick={handleImportFromClaudeCode}
        role="menuitem"
      >
        <span className="dropdown-menu-item-icon"><Upload size={16} strokeWidth={1.5} /></span>
        <span className="dropdown-menu-item-text">Import from AGENT.md (Claude Code)</span>
      </button>
    </div>
  );
};

export default SubAgentsAddMenuDropdown;
