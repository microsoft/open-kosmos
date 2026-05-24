import React, { useLayoutEffect, useRef, createElement } from 'react';
import { Trash2, Download, Pencil, Star, Copy } from 'lucide-react';
import { adjustAnchoredDropdownToViewport, ANCHORED_DROPDOWN_SIZE_PRESETS, AnchoredDropdownPosition, getAnchoredDropdownPosition } from '../../lib/utilities/dropdownPosition';
import { atom } from '@/atom';
import { useClickOut } from '../ui/use-click-out';
import { createLogger } from '../../lib/utilities/logger';
import { useAuthContext } from '../auth/AuthProvider';
const logger = createLogger('[ChatSessionDropdownMenu]');

const zeroState: {
  isOpen: boolean;
  chatId: string | null;
  sessionId: string | null;
  title: string | null;
  starred: boolean;
  source: 'default' | 'schedule';
  position: AnchoredDropdownPosition | null;
} = {
  isOpen: false,
  chatId: null,
  sessionId: null,
  title: null,
  starred: false,
  source: 'default',
  position: null,
};

export const ChatSessionMenuAtom = atom(zeroState, (get, set) => {
  function close() {
    set(zeroState);
  }

  function toggle(
    chatId: string,
    sessionId: string,
    title: string,
    buttonElement: HTMLElement,
  ) {
    const prev = get();
    if (prev.isOpen && prev.sessionId === sessionId) {
      return set(zeroState);
    }

    const source = buttonElement.dataset.chatSessionMenuSource === 'schedule'
      ? 'schedule' as const
      : 'default' as const;
    const starred = buttonElement.dataset.chatSessionStarred === 'true';

    const position = getAnchoredDropdownPosition(
      buttonElement,
      source === 'schedule'
        ? ANCHORED_DROPDOWN_SIZE_PRESETS.scheduledChatSessionMenu
        : ANCHORED_DROPDOWN_SIZE_PRESETS.chatSessionMenu,
    );
    set({ isOpen: true, chatId, sessionId, title, starred, source, position });
  }

  return { toggle, close };
});

interface InnerProps {
  alias?: string | null;
  chatId: string | null;
  sessionId: string;
  title: string | null;
  starred: boolean;
  source: 'default' | 'schedule';
  position: AnchoredDropdownPosition;
}

const ChatSessionDropdownMenu: React.FC<InnerProps> = ({
  alias,
  chatId,
  sessionId,
  title,
  starred,
  source,
  position,
}) => {
  const { close: onClose } = ChatSessionMenuAtom.useChange();
  const chatSessionMenuRef = useRef<HTMLDivElement>(null);

  useClickOut(chatSessionMenuRef, onClose);

  const isScheduleMenu = source === 'schedule';
  const handleToggleStarChatSession = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!chatId || isScheduleMenu) {
      onClose();
      return;
    }
    window.dispatchEvent(new CustomEvent('chatSession:toggleStar', {
      detail: { chatId, sessionId, starred: !starred }
    }));
    onClose();
  };

  const handleCopyFilePath = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    if (!alias || !chatId || !window.electronAPI?.chatSessionOps?.getChatSessionFilePath) {
      onClose();
      return;
    }

    try {
      const result = await window.electronAPI.chatSessionOps.getChatSessionFilePath(alias, chatId, sessionId);
      if (result?.success && result.filePath) {
        await navigator.clipboard.writeText(result.filePath);
      }
    } catch (error) {
      logger.error('[ChatSessionDropdownMenu] Failed to copy file path:', error);
    }

    onClose();
  };

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

  // 🔥 New: download ChatSession handler
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
      adjustAnchoredDropdownToViewport(chatSessionMenuRef.current, position);
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
        minWidth: 'fit-content',
        maxWidth: 'calc(100vw - 20px)',
        width: 'max-content'
      }}
      role="menu"
    >
      {!isScheduleMenu && (
        <button
          className="dropdown-menu-item"
          onClick={handleToggleStarChatSession}
          role="menuitem"
        >
          <span className="dropdown-menu-item-icon">
            <Star size={16} strokeWidth={1.5} fill={starred ? 'currentColor' : 'none'} />
          </span>
          <span className="dropdown-menu-item-text">{starred ? 'Unstar' : 'Star'}</span>
        </button>
      )}
      {!isScheduleMenu && (
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
      )}
      {!isScheduleMenu && (
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
          <span className="dropdown-menu-item-text">Fork</span>
        </button>
      )}
      {!isScheduleMenu && !!alias && !!chatId && (
        <button
          className="dropdown-menu-item"
          onClick={handleCopyFilePath}
          role="menuitem"
        >
          <span className="dropdown-menu-item-icon">
            <Copy size={16} strokeWidth={1.5} />
          </span>
          <span className="dropdown-menu-item-text">Copy File Path</span>
        </button>
      )}
      <button
        className="dropdown-menu-item"
        onClick={handleDownloadChatSession}
        role="menuitem"
      >
        <span className="dropdown-menu-item-icon">
          <Download size={16} strokeWidth={1.5} />
        </span>
        <span className="dropdown-menu-item-text">Download</span>
      </button>
      <button
        className="dropdown-menu-item danger"
        onClick={handleDeleteChatSession}
        role="menuitem"
      >
        <span className="dropdown-menu-item-icon">
          <Trash2 size={16} strokeWidth={1.5} />
        </span>
        <span className="dropdown-menu-item-text">Delete</span>
      </button>
    </div>
  );
};

export default () => {
  const [{ isOpen, chatId, sessionId, title, starred, source, position }] = ChatSessionMenuAtom.use();
  const { authData } = useAuthContext();
  const alias = authData?.ghcAuth?.alias ?? null;
  if (!isOpen || !position || !sessionId) return null;
  return createElement(ChatSessionDropdownMenu, { alias, chatId, sessionId, title, starred, source, position });
};
