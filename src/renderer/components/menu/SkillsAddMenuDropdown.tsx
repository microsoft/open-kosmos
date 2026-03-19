import React, { useLayoutEffect } from 'react';
import { Plus } from 'lucide-react';

interface SkillsAddMenuDropdownProps {
  skillsAddMenuRef: React.RefObject<HTMLDivElement>;
  position: { top: number; left: number };
  onClose: () => void;
}

const SkillsAddMenuDropdown: React.FC<SkillsAddMenuDropdownProps> = ({
  skillsAddMenuRef,
  position,
  onClose
}) => {
  const handleAddFromDevice = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    // Trigger add from local device event
    window.dispatchEvent(new CustomEvent('skills:addFromDevice'));
    onClose();
  };

  // 🔧 Fix: Adjust menu position if it overflows window bottom
  useLayoutEffect(() => {
    if (skillsAddMenuRef.current) {
      const rect = skillsAddMenuRef.current.getBoundingClientRect();
      const windowHeight = window.innerHeight;
      const padding = 10;
      
      // Check if we have triggerTop info (passed via position prop extension)
      const triggerTop = (position as any).triggerTop;
      
      if (rect.bottom > windowHeight - padding) {
        // If it overflows bottom, try to position above the trigger
        if (triggerTop !== undefined) {
           const newTop = triggerTop - rect.height - 4;
           skillsAddMenuRef.current.style.top = `${Math.max(padding, newTop)}px`;
        } else {
           // Fallback to just shifting up if no trigger info
           const newTop = windowHeight - rect.height - padding;
           skillsAddMenuRef.current.style.top = `${Math.max(padding, newTop)}px`;
        }
      }
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
        onClick={handleAddFromDevice}
        role="menuitem"
      >
        <span className="dropdown-menu-item-icon"><Plus size={16} strokeWidth={1.5} /></span>
        <span className="dropdown-menu-item-text">Add from Device</span>
      </button>
    </div>
  );
};

export default SkillsAddMenuDropdown;