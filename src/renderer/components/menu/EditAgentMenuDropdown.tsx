import React, { useLayoutEffect, useRef, createElement } from 'react';
import { adjustAnchoredDropdownToViewport, ANCHORED_DROPDOWN_SIZE_PRESETS, AnchoredDropdownPosition, getAnchoredDropdownPosition } from '../../lib/utilities/dropdownPosition';
import { atom } from '@/atom';
import { useClickOut } from '../ui/use-click-out';

const zeroState: {
  isOpen: boolean;
  position: AnchoredDropdownPosition | null;
} = { isOpen: false, position: null };

export const EditAgentMenuAtom = atom(zeroState, (get, set) => {
  function close() {
    set(zeroState);
  }

  function toggle(buttonElement: HTMLElement) {
    if (get().isOpen) {
      return set(zeroState);
    }
    const position = getAnchoredDropdownPosition(
      buttonElement,
      ANCHORED_DROPDOWN_SIZE_PRESETS.editAgentMenu,
    );
    set({ isOpen: true, position });
  }

  return { toggle, close };
});

interface InnerProps {
  position: AnchoredDropdownPosition;
}

const EditAgentMenuDropdown: React.FC<InnerProps> = ({ position }) => {
  const { close: onClose } = EditAgentMenuAtom.useChange();
  const editAgentMenuRef = useRef<HTMLDivElement>(null);

  useClickOut(editAgentMenuRef, onClose);

  useLayoutEffect(() => {
    if (editAgentMenuRef.current) {
      adjustAnchoredDropdownToViewport(editAgentMenuRef.current, position);
    }
  }, [position]);

  const handleSelectMcpTools = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    // Trigger open MCP Tools tab event
    window.dispatchEvent(new CustomEvent('agent:editAgent', {
      detail: {
        chatId: null, // Will be obtained from the current chatId in ContentContainer
        initialTab: 'mcp'
      }
    }));
    onClose();
  };

  const handleSelectSkills = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    // Trigger open Skills tab event
    window.dispatchEvent(new CustomEvent('agent:editAgent', {
      detail: {
        chatId: null, // Will be obtained from the current chatId in ContentContainer
        initialTab: 'skills'
      }
    }));
    onClose();
  };

  const handleEditSystemPrompt = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    // Trigger open System Prompt tab event
    window.dispatchEvent(new CustomEvent('agent:editAgent', {
      detail: {
        chatId: null, // Will be obtained from the current chatId in ContentContainer
        initialTab: 'prompt'
      }
    }));
    onClose();
  };

  return (
    <div
      ref={editAgentMenuRef}
      className="dropdown-menu edit-agent-dropdown-menu"
      style={{
        top: `${position.top}px`,
        left: `${position.left}px`
      }}
      role="menu"
    >
      <button
        className="dropdown-menu-item"
        onClick={handleSelectMcpTools}
        role="menuitem"
      >
        <span className="dropdown-menu-item-icon">
          <svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </svg>
        </span>
        <span className="dropdown-menu-item-text">Select MCP Tools</span>
      </button>
      <button
        className="dropdown-menu-item"
        onClick={handleSelectSkills}
        role="menuitem"
      >
        <span className="dropdown-menu-item-icon">
          <svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24">
            <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </svg>
        </span>
        <span className="dropdown-menu-item-text">Select Skills</span>
      </button>
      <button
        className="dropdown-menu-item"
        onClick={handleEditSystemPrompt}
        role="menuitem"
      >
        <span className="dropdown-menu-item-icon">
          <svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24">
            <path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </svg>
        </span>
        <span className="dropdown-menu-item-text">Edit System Prompt</span>
      </button>
    </div>
  );
};

export default () => {
  const [{ isOpen, position }] = EditAgentMenuAtom.use();
  if (!isOpen || !position) return null;
  return createElement(EditAgentMenuDropdown, { position });
};
