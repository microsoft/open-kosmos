import React, { useLayoutEffect } from 'react';
import { useFeatureFlag } from '../../lib/featureFlags';

interface EditAgentMenuDropdownProps {
  editAgentMenuRef: React.RefObject<HTMLDivElement>;
  position: { top: number; left: number };
  onClose: () => void;
}

const EditAgentMenuDropdown: React.FC<EditAgentMenuDropdownProps> = ({
  editAgentMenuRef,
  position,
  onClose
}) => {
  // Memory/Context Enhancement controlled by feature flag (Dev environment and non-Windows ARM)
  const memoryEnabled = useFeatureFlag('kosmosFeatureMemory');

  // Use measured height to adjust menu position: if it overflows the bottom, display above the button
  useLayoutEffect(() => {
    if (editAgentMenuRef.current) {
      const rect = editAgentMenuRef.current.getBoundingClientRect();
      const windowHeight = window.innerHeight;
      const padding = 10;
      const triggerTop = (position as any).triggerTop;

      if (rect.bottom > windowHeight - padding && triggerTop !== undefined) {
        // Use the measured menu height (rect.height) to precisely calculate upward position
        const newTop = triggerTop - rect.height - 4;
        editAgentMenuRef.current.style.top = `${Math.max(padding, newTop)}px`;
      }
    }
  }, [position]);

  const handleSelectMcpTools = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    // Trigger opening MCP Tools tab event
    window.dispatchEvent(new CustomEvent('agent:editAgent', {
      detail: {
        chatId: null, // Will get the current chatId in ContentContainer
        initialTab: 'mcp'
      }
    }));
    onClose();
  };

  const handleSelectSkills = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    // Trigger opening Skills tab event
    window.dispatchEvent(new CustomEvent('agent:editAgent', {
      detail: {
        chatId: null, // Will get the current chatId in ContentContainer
        initialTab: 'skills'
      }
    }));
    onClose();
  };

  const handleEditSystemPrompt = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    // Trigger opening System Prompt tab event
    window.dispatchEvent(new CustomEvent('agent:editAgent', {
      detail: {
        chatId: null, // Will get the current chatId in ContentContainer
        initialTab: 'prompt'
      }
    }));
    onClose();
  };

  const handleConfigContextEnhancement = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    // Trigger opening Context Enhancement tab event
    window.dispatchEvent(new CustomEvent('agent:editAgent', {
      detail: {
        chatId: null, // Will get the current chatId in ContentContainer
        initialTab: 'context'
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
      {/* Context Enhancement option only shown in Dev environment */}
      {memoryEnabled && (
        <button
          className="dropdown-menu-item"
          onClick={handleConfigContextEnhancement}
          role="menuitem"
        >
          <span className="dropdown-menu-item-icon">
            <svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24">
              <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
              <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </svg>
          </span>
          <span className="dropdown-menu-item-text">Config Context Enhancement</span>
        </button>
      )}
    </div>
  );
};

export default EditAgentMenuDropdown;