import React, { useLayoutEffect, useState, useRef, createElement } from 'react';
import { Pencil, Trash2, Copy, Upload, Archive } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useProfileData } from '../userData/userDataProvider';
import { useChatAgent, resolveChatAgent } from '../../lib/agent';
import { useToast } from '../ui/ToastProvider';
import { isBuiltinAgent } from '../../lib/userData/types';
import { BRAND_NAME } from '@shared/constants/branding';
import {
  adjustAnchoredDropdownToViewport,
  ANCHORED_DROPDOWN_SIZE_PRESETS,
  AnchoredDropdownPosition,
  getAnchoredDropdownPosition,
} from '../../lib/utilities/dropdownPosition';
import { profileDataManager } from "../../lib/userData";
import { atom } from '@/atom';
import { useClickOut } from '../ui/use-click-out';
import { DuplicateAgentAtom } from '../overlay/DuplicateAgentOverlay';
import { DeleteConfirmAtom } from '../overlay/DeleteOverlay';
import { ArchiveConfirmAtom } from '../overlay/ArchiveOverlay';
import { useI18n } from '../../lib/i18n/useI18n';

const zeroState: {
  isOpen: boolean;
  chatId: string | null;
  position: AnchoredDropdownPosition | null;
  anchorElement: HTMLElement | null;
} = { isOpen: false, chatId: null, position: null, anchorElement: null };

export const AgentMenuAtom = atom(zeroState, (get, set) => {
  function close() {
    set(zeroState);
  }

  function toggle(chatId: string, buttonElement: HTMLElement) {
    const prev = get();
    if (prev.isOpen && prev.chatId === chatId) {
      return set(zeroState);
    }
    const position = getAnchoredDropdownPosition(
      buttonElement,
      ANCHORED_DROPDOWN_SIZE_PRESETS.agentMenu,
    );
    set({ isOpen: true, chatId, position, anchorElement: buttonElement });
  }

  return { toggle, close };
});


interface InnerProps {
  position: AnchoredDropdownPosition;
  chatId: string | null;
  anchorElement: HTMLElement | null;
}

const AgentDropdownMenu: React.FC<InnerProps> = ({
  position,
  chatId,
  anchorElement,
}) => {
  const { close: onClose } = AgentMenuAtom.useChange();
  const agentMenuRef = useRef<HTMLDivElement>(null);
  const { chats, data } = useProfileData();
  const { showSuccess, showError } = useToast();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [isImporting, setIsImporting] = useState(false);
  const onDuplicateAgent = DuplicateAgentAtom.useChange().show;
  const deleteConfirmActions = DeleteConfirmAtom.useChange();
  const archiveConfirmActions = ArchiveConfirmAtom.useChange();

  useClickOut(agentMenuRef, onClose);

  // Re-anchor from the live trigger so list expansion/collapse does not leave a stale menu position.
  useLayoutEffect(() => {
    /* v8 ignore next 3 -- ref is always set when component renders */
    if (!agentMenuRef.current) {
      return;
    }

    let animationFrameId: number | null = null;

    const updatePosition = () => {
      /* v8 ignore next 3 -- defensive null check; ref is set before rAF fires */
      if (!agentMenuRef.current) {
        return;
      }

      if (anchorElement?.isConnected) {
        const rect = agentMenuRef.current.getBoundingClientRect();
        const nextPosition = getAnchoredDropdownPosition(anchorElement, {
          estimatedWidth: rect.width,
          estimatedHeight: rect.height,
        });
        agentMenuRef.current.style.left = `${nextPosition.left}px`;
        agentMenuRef.current.style.top = `${nextPosition.top}px`;
        adjustAnchoredDropdownToViewport(agentMenuRef.current, nextPosition);
        return;
      }

      adjustAnchoredDropdownToViewport(agentMenuRef.current, position);
    };

    updatePosition();
    animationFrameId = window.requestAnimationFrame(updatePosition);

    const handleViewportChange = () => {
      updatePosition();
    };

    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);

    return () => {
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId);
      }
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [anchorElement, position]);

  // Find current chat config
  const currentChat = chats.find(chat => chat.chat_id === chatId);
  const currentAgent = useChatAgent(currentChat);

  // Determine if this is a built-in agent (list differs by branding) - cannot be deleted
  const isBuiltinAgentFlag = isBuiltinAgent(currentAgent?.name, BRAND_NAME);

  // Get the current primary chat id
  const primaryChat = data?.profile?.primaryChat;

  // Check if the current chat is already the primary chat
  const isPrimaryChat = primaryChat === currentChat?.chat_id;

  const handleEditAgentClick = (chatId: string) => {
    onClose();
    window.dispatchEvent(new CustomEvent('agent:editAgent', { detail: { chatId } }));
  };

  const handleDeleteAgentClick = (chatId: string) => {
    onClose();
    const chat = chats.find((c) => c.chat_id === chatId);
    const agentName = resolveChatAgent(chat)?.name || 'Unknown Agent';
    deleteConfirmActions.showAgent(chatId, agentName, false);
  };

  const handleArchiveAgentClick = (chatId: string) => {
    onClose();
    const chat = chats.find((c) => c.chat_id === chatId);
    const agentName = resolveChatAgent(chat)?.name || 'Unknown Agent';
    archiveConfirmActions.show(chatId, agentName);
  };

  // Handle duplicating an Agent
  const handleDuplicateAgent = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (chatId && currentAgent?.name) {
      onDuplicateAgent(chatId, currentAgent.name);
    }
    onClose();
  };

  // Handle setting as primary chat
  const handleSetAsPrimaryAgent = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    if (!currentChat?.chat_id) {
      showError(t('agent.menu.chatNotFound'));
      return;
    }

    try {
      if (!window.electronAPI?.profile?.setPrimaryChat) {
        showError(t('agent.menu.setPrimaryApiUnavailable'));
        return;
      }

      const result = await window.electronAPI.profile.setPrimaryChat(currentChat.chat_id);

      if (result.success) {
        showSuccess(t('agent.menu.setPrimarySuccess', { name: currentAgent?.name ?? 'Chat' }));
        // Refresh profile data to update UI
        await profileDataManager.refresh();
        // Close the menu
        onClose();
      } else {
        showError(t('agent.menu.setPrimaryFailed', { error: result.error || t('common.unknownError') }));
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : t('common.unknownError');
      showError(t('agent.menu.setPrimaryFailed', { error: errorMessage }));
    }
  };

  // Import a single ChatSession JSON file into the current agent.
  const handleImportChatSessions = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    /* v8 ignore next 4 -- chatId is always set when menu is open (atom toggle requires it) */
    if (!chatId) {
      showError(t('agent.menu.chatIdNotFound'));
      return;
    }

    /* v8 ignore next 3 -- React state batching prevents testing this guard in unit tests */
    if (isImporting) {
      return;
    }

    try {
      setIsImporting(true);

      if (!window.electronAPI?.agentChat?.importChatSession) {
        showError(t('agent.menu.importApiUnavailable'));
        return;
      }

      const result = await window.electronAPI.agentChat.importChatSession(chatId);

      if (result.success) {
        if (result.importedSessionId) {
          await profileDataManager.refresh();
          navigate(`/agent/chat/${chatId}/${result.importedSessionId}`);
        }
        showSuccess(t('agent.menu.importSuccess'));
        onClose();
      } else {
        if (result.error !== 'File selection canceled') {
          showError(t('agent.menu.importFailed', { error: result.error || t('common.unknownError') }));
        }
        onClose();
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : t('common.unknownError');
      showError(t('agent.menu.importFailed', { error: errorMessage }));
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div
      ref={agentMenuRef}
      className="dropdown-menu agent-dropdown-menu"
      style={{
        top: `${position.top}px`,
        left: `${position.left}px`
      }}
      role="menu"
    >
      <button
        className="dropdown-menu-item"
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          handleEditAgentClick(chatId!);
        }}
        role="menuitem"
      >
        <span className="dropdown-menu-item-icon"><Pencil size={16} strokeWidth={1.5} /></span>
        <span className="dropdown-menu-item-text">{t('agent.menu.editAgent')}</span>
      </button>
      {/* Only show this option when the current chat is not primary */}
      {!isPrimaryChat && (
        <button
          className="dropdown-menu-item"
          onClick={handleSetAsPrimaryAgent}
          role="menuitem"
        >
          <span className="dropdown-menu-item-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
          </span>
          <span className="dropdown-menu-item-text">{t('agent.menu.setPrimary')}</span>
        </button>
      )}
      {/* Import a single ChatSession JSON file */}
      <button
        className="dropdown-menu-item"
        onClick={handleImportChatSessions}
        disabled={isImporting}
        role="menuitem"
      >
        <span className="dropdown-menu-item-icon"><Upload size={16} strokeWidth={1.5} /></span>
        <span className="dropdown-menu-item-text">{isImporting ? t('agent.menu.importing') : t('agent.menu.importChatSession')}</span>
      </button>
      {/* Duplicate Agent menu item: available for all agents */}
      {currentAgent?.name && (
        <button
          className="dropdown-menu-item"
          onClick={handleDuplicateAgent}
          role="menuitem"
        >
          <span className="dropdown-menu-item-icon"><Copy size={16} strokeWidth={1.5} /></span>
          <span className="dropdown-menu-item-text">{t('common.duplicate')}</span>
        </button>
      )}
      {/* Archive menu item: only shown when not a built-in agent and not the primary chat */}
      {!isBuiltinAgentFlag && !isPrimaryChat && (
        <button
          className="dropdown-menu-item"
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            /* v8 ignore next -- chatId is always set when menu is open */
            if (chatId) {
              handleArchiveAgentClick(chatId);
            }
          }}
          role="menuitem"
        >
          <span className="dropdown-menu-item-icon"><Archive size={16} strokeWidth={1.5} /></span>
          <span className="dropdown-menu-item-text">{t('common.archive')}</span>
        </button>
      )}
      {/* Delete menu item: only shown when not a built-in agent and not the primary chat */}
      {!isBuiltinAgentFlag && !isPrimaryChat && (
        <button
          className="dropdown-menu-item danger"
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            handleDeleteAgentClick(chatId!);
          }}
          role="menuitem"
        >
          <span className="dropdown-menu-item-icon"><Trash2 size={16} strokeWidth={1.5} /></span>
          <span className="dropdown-menu-item-text">{t('common.delete')}</span>
        </button>
      )}
    </div>
  );
};

export default () => {
  const [{ isOpen, position, chatId, anchorElement }] = AgentMenuAtom.use();
  if (!isOpen || !position) return null;
  return createElement(AgentDropdownMenu, { position, chatId, anchorElement });
};
