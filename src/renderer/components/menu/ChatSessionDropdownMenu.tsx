import React, { useLayoutEffect } from 'react';
import { Trash2, Download, Pencil } from 'lucide-react';

interface ChatSessionDropdownMenuProps {
  chatSessionMenuRef: React.RefObject<HTMLDivElement>;
  chatId: string | null;
  sessionId: string;
  title: string;  // 🔥 New: ChatSession title
  position: { top: number; left: number };
  onClose: () => void;
}

const ChatSessionDropdownMenu: React.FC<ChatSessionDropdownMenuProps> = ({
  chatSessionMenuRef,
  chatId,
  sessionId,
  title,
  position,
  onClose
}) => {
  const handleRenameChatSession = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    window.dispatchEvent(new CustomEvent('chatSession:rename', {
      detail: { chatId, sessionId, title }
    }));
    onClose();
  };

  const handleForkChatSession = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    // Trigger fork ChatSession event
    window.dispatchEvent(new CustomEvent('chatSession:fork', {
      detail: { sessionId }
    }));
    onClose();
  };

  // 🔥 New: Download ChatSession handler
  const handleDownloadChatSession = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    // Trigger download ChatSession event
    window.dispatchEvent(new CustomEvent('chatSession:download', {
      detail: { chatId, sessionId, title }
    }));
    onClose();
  };

  const handleDeleteChatSession = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    // Trigger delete ChatSession event
    window.dispatchEvent(new CustomEvent('chatSession:delete', {
      detail: { sessionId }
    }));
    onClose();
  };

  // 🔧 Fix: Adjust menu position if it overflows window bottom
  useLayoutEffect(() => {
    if (chatSessionMenuRef.current) {
      const rect = chatSessionMenuRef.current.getBoundingClientRect();
      const windowHeight = window.innerHeight;
      const padding = 10;
      
      // Check if we have triggerTop info (passed via position prop extension)
      const triggerTop = (position as any).triggerTop;
      
      if (rect.bottom > windowHeight - padding) {
        // If it overflows bottom, try to position above the trigger
        if (triggerTop !== undefined) {
           const newTop = triggerTop - rect.height - 4;
           chatSessionMenuRef.current.style.top = `${Math.max(padding, newTop)}px`;
        } else {
           // Fallback to just shifting up if no trigger info
           const newTop = windowHeight - rect.height - padding;
           chatSessionMenuRef.current.style.top = `${Math.max(padding, newTop)}px`;
        }
      }
    }
  }, [position]);

  return (
    <div
      ref={chatSessionMenuRef}
      className="dropdown-menu chat-session-dropdown-menu"
      style={{
        top: `${position.top}px`,
        left: `${position.left}px`,
        position: 'fixed',
        zIndex: 1000,
        minWidth: '180px',
        maxWidth: '220px',
        width: 'auto'
      }}
      role="menu"
    >
      <button
        className="dropdown-menu-item"
        onClick={handleRenameChatSession}
        role="menuitem"
      >
        <span className="dropdown-menu-item-icon">
          <Pencil size={16} strokeWidth={1.5} />
        </span>
        <span className="dropdown-menu-item-text">Rename</span>
      </button>
      <button
        className="dropdown-menu-item"
        onClick={handleForkChatSession}
        role="menuitem"
      >
        <span className="dropdown-menu-item-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M6 3v12c0 2 1 3 3 3h6"></path>
            <path d="M15 21l3-3-3-3"></path>
            <path d="M6 3a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v12c0 1-1 2-2 2h-4"></path>
          </svg>
        </span>
        <span className="dropdown-menu-item-text">Fork Chat Session</span>
      </button>
      {/* 🔥 New: Download ChatSession button */}
      <button
        className="dropdown-menu-item"
        onClick={handleDownloadChatSession}
        role="menuitem"
      >
        <span className="dropdown-menu-item-icon">
          <Download size={16} strokeWidth={1.5} />
        </span>
        <span className="dropdown-menu-item-text">Download Chat Session</span>
      </button>
      <button
        className="dropdown-menu-item danger"
        onClick={handleDeleteChatSession}
        role="menuitem"
      >
        <span className="dropdown-menu-item-icon">
          <Trash2 size={16} strokeWidth={1.5} />
        </span>
        <span className="dropdown-menu-item-text">Delete Chat Session</span>
      </button>
    </div>
  );
};

export default ChatSessionDropdownMenu;