import React, { useLayoutEffect } from 'react';
import { FolderPlus, Plus } from 'lucide-react';
import { adjustAnchoredDropdownToViewport, AnchoredDropdownPosition } from '../../lib/utilities/dropdownPosition';

interface SkillsAddMenuDropdownProps {
  skillsAddMenuRef: React.RefObject<HTMLDivElement>;
  position: AnchoredDropdownPosition;
  onClose: () => void;
}

const SkillsAddMenuDropdown: React.FC<SkillsAddMenuDropdownProps> = ({
  skillsAddMenuRef,
  position,
  onClose
}) => {
  const handleAddFromDeviceArtifact = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    window.dispatchEvent(new CustomEvent('skills:addFromDeviceArtifact'));
    onClose();
  };

  const handleAddFromDeviceFolder = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    window.dispatchEvent(new CustomEvent('skills:addFromDeviceFolder'));
    onClose();
  };

  // 🔧 Fix: Adjust menu position if it overflows window bottom
  useLayoutEffect(() => {
    if (skillsAddMenuRef.current) {
      adjustAnchoredDropdownToViewport(skillsAddMenuRef.current, position);
    }
  }, [position]);

  return (
    <div
      ref={skillsAddMenuRef}
      className="dropdown-menu skills-add-dropdown-menu"
      style={{
        top: `${position.top}px`,
        left: `${position.left}px`
      }}
      role="menu"
    >
      <button
        className="dropdown-menu-item"
        onClick={handleAddFromDeviceArtifact}
        role="menuitem"
      >
        <span className="dropdown-menu-item-icon"><Plus size={16} strokeWidth={1.5} /></span>
        <span className="dropdown-menu-item-text">Add from Device (.zip/.skill)</span>
      </button>
      <button
        className="dropdown-menu-item"
        onClick={handleAddFromDeviceFolder}
        role="menuitem"
      >
        <span className="dropdown-menu-item-icon"><FolderPlus size={16} strokeWidth={1.5} /></span>
        <span className="dropdown-menu-item-text">Add from Device (folder)</span>
      </button>
    </div>
  );
};

export default SkillsAddMenuDropdown;