import React, { useLayoutEffect, useState, useRef, createElement, useCallback } from 'react';
import { Pencil, Trash2, Copy, Upload, Archive } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useProfileData } from '../userData/userDataProvider';
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
  const navigate = useNavigate();
  const [isImporting, setIsImporting] = useState(false);
  const onDuplicateAgent = DuplicateAgentAtom.useChange().show;
  const deleteConfirmActions = DeleteConfirmAtom.useChange();

  useClickOut(agentMenuRef, onClose);

  // Re-anchor from the live trigger so list expansion/collapse does not leave a stale menu position.
  useLayoutEffect(() => {
    if (!agentMenuRef.current) {
      return;
    }

    let animationFrameId: number | null = null;

    const updatePosition = () => {
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

  // Determine if this is a built-in agent (list differs by branding) - cannot be deleted
  const isBuiltinAgentFlag = isBuiltinAgent(currentChat?.agent?.name, BRAND_NAME);

  // Get current primaryAgent
  const primaryAgent = data?.profile?.primaryAgent;

  // Check if the current Agent is already the Primary Agent
  const isPrimaryAgent = primaryAgent === currentChat?.agent?.name;

  const handleEditAgentClick = (chatId: string) => {
    onClose();
    window.dispatchEvent(new CustomEvent('agent:editAgent', { detail: { chatId } }));
  };

  const handleDeleteAgentClick = (chatId: string) => {
    onClose();
    const chat = chats.find((c) => c.chat_id === chatId);
    const agentName = chat?.agent?.name || 'Unknown Agent';
    deleteConfirmActions.showAgent(chatId, agentName, false);
  };

  // Handle archiving an agent
  const onArchiveAgent = useCallback(async (chatId: string) => {
    try {
      const chat = chats.find((c) => c.chat_id === chatId);
      const agentName = chat?.agent?.name || 'Unknown Agent';

      if (!window.electronAPI?.profile?.archiveChatConfig) {
        showError('Archive API not available');
        return;
      }

      const result = await window.electronAPI.profile.archiveChatConfig(chatId);

      if (result.success) {
        showSuccess(`Agent "${agentName}" archived successfully`);
        // Refresh profile data to update UI
        await profileDataManager.refresh();
      } else {
        showError(`Failed to archive agent: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      showError(`Failed to archive agent: ${errorMessage}`);
    }
  }, [chats, showSuccess, showError]);

  // Handle duplicating an Agent
  const handleDuplicateAgent = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (chatId && currentChat?.agent?.name) {
      onDuplicateAgent(chatId, currentChat.agent.name);
    }
    onClose();
  };

  // Handle setting as Primary Agent
  const handleSetAsPrimaryAgent = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    if (!currentChat?.agent?.name) {
      showError('Agent name not found');
      return;
    }

    try {
      if (!window.electronAPI?.profile?.setPrimaryAgent) {
        showError('setPrimaryAgent API not available');
        return;
      }

      const result = await window.electronAPI.profile.setPrimaryAgent(currentChat.agent.name);

      if (result.success) {
        showSuccess(`${currentChat.agent.name} has been set as primary agent`);
        // Refresh profile data to update UI
        await profileDataManager.refresh();
        // Close the menu
        onClose();
      } else {
        showError(`Failed to set primary agent: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      showError(`Failed to set primary agent: ${errorMessage}`);
    }
  };

  // Import a single ChatSession JSON file into the current agent.
  const handleImportChatSessions = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    if (!chatId) {
      showError('Chat ID not found');
      return;
    }

    if (isImporting) {
      return;
    }

    try {
      setIsImporting(true);

      if (!window.electronAPI?.agentChat?.importChatSession) {
        showError('Import API not available');
        return;
      }

      const result = await window.electronAPI.agentChat.importChatSession(chatId);

      if (result.success) {
        if (result.importedSessionId) {
          await profileDataManager.refresh();
          navigate(`/agent/chat/${chatId}/${result.importedSessionId}`);
        }
        showSuccess('Successfully imported chat session');
        onClose();
      } else {
        if (result.error !== 'File selection canceled') {
          showError(`Import failed: ${result.error || 'Unknown error'}`);
        }
        onClose();
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      showError(`Import failed: ${errorMessage}`);
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
        <span className="dropdown-menu-item-text">Edit Agent</span>
      </button>
      {/* Only show this option when the current Agent is not the Primary Agent */}
      {!isPrimaryAgent && (
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
          <span className="dropdown-menu-item-text">Set as Primary Agent</span>
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
        <span className="dropdown-menu-item-text">{isImporting ? 'Importing...' : 'Import Chat Session JSON'}</span>
      </button>
      {/* Duplicate Agent menu item: available for all agents */}
      {currentChat?.agent?.name && (
        <button
          className="dropdown-menu-item"
          onClick={handleDuplicateAgent}
          role="menuitem"
        >
          <span className="dropdown-menu-item-icon"><Copy size={16} strokeWidth={1.5} /></span>
          <span className="dropdown-menu-item-text">Duplicate</span>
        </button>
      )}
      {/* Archive Agent menu item: only shown when not a built-in agent and not the Primary Agent */}
      {onArchiveAgent && !isBuiltinAgentFlag && !isPrimaryAgent && (
        <button
          className="dropdown-menu-item"
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            if (chatId) {
              onArchiveAgent(chatId);
            }
            onClose();
          }}
          role="menuitem"
        >
          <span className="dropdown-menu-item-icon"><Archive size={16} strokeWidth={1.5} /></span>
          <span className="dropdown-menu-item-text">Archive Agent</span>
        </button>
      )}
      {/* Delete Agent menu item: only shown when not a built-in agent and not the Primary Agent */}
      {!isBuiltinAgentFlag && !isPrimaryAgent && (
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
          <span className="dropdown-menu-item-text">Delete Agent</span>
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
