import React, { useLayoutEffect } from 'react';
import { FolderPlus, Plus, Store } from 'lucide-react';
import { adjustAnchoredDropdownToViewport, AnchoredDropdownPosition } from '../../lib/utilities/dropdownPosition';
import { isCdnConfigured } from '@shared/utils/cdn';

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

  const handleAddFromLibrary = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    // Trigger add from Skill Library event
    window.dispatchEvent(new CustomEvent('skills:addFromLibrary'));
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
      {/* Skill Library is a CDN-backed optional feature; hide entry when no CDN is configured */}
      {isCdnConfigured() && (
      <button
        className="dropdown-menu-item"
        onClick={handleAddFromLibrary}
        role="menuitem"
      >
        <span className="dropdown-menu-item-icon"><Store size={16} strokeWidth={1.5} /></span>
        <span className="dropdown-menu-item-text">Add from Skill Library</span>
      </button>
      )}
    </div>
  );
};

export default SkillsAddMenuDropdown;