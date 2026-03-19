import React, { useLayoutEffect, useState } from 'react';
import { Pencil, Trash2, Copy, Upload } from 'lucide-react';
import { useProfileData } from '../userData/userDataProvider';
import { useToast } from '../ui/ToastProvider';
import { isBuiltinAgent } from '../../lib/userData/types';
import { BRAND_NAME } from '@shared/constants/branding';

interface AgentDropdownMenuProps {
  agentMenuRef: React.RefObject<HTMLDivElement>;
  chatId: string | null;
  position: { top: number; left: number };
  onEditAgent?: (chatId: string) => void;
  onDeleteAgent?: (chatId: string) => void;
  onDuplicateAgent?: (chatId: string, agentName: string) => void;
  handleEditAgentClick: (chatId: string) => void;
  handleDeleteAgentClick: (chatId: string) => void;
  onClose?: () => void;
}

const AgentDropdownMenu: React.FC<AgentDropdownMenuProps> = ({
  agentMenuRef,
  chatId,
  position,
  onEditAgent,
  onDeleteAgent,
  onDuplicateAgent,
  handleEditAgentClick,
  handleDeleteAgentClick,
  onClose
}) => {
  const { chats, data } = useProfileData();
  const { showSuccess, showError } = useToast();
  
  // 🔧 Fix: Adjust menu position if it overflows window bottom
  useLayoutEffect(() => {
    if (agentMenuRef.current) {
      const rect = agentMenuRef.current.getBoundingClientRect();
      const windowHeight = window.innerHeight;
      const padding = 10;
      
      // Check if we have triggerTop info (passed via position prop extension)
      const triggerTop = (position as any).triggerTop;

      if (rect.bottom > windowHeight - padding) {
        // If it overflows bottom, try to position above the trigger
        if (triggerTop !== undefined) {
           const newTop = triggerTop - rect.height - 4;
           // Ensure we don't go off the top either
           agentMenuRef.current.style.top = `${Math.max(padding, newTop)}px`;
        } else {
           // Fallback to just shifting up if no trigger info
           const newTop = windowHeight - rect.height - padding;
           agentMenuRef.current.style.top = `${Math.max(padding, newTop)}px`;
        }
      }
    }
  }, [position]);

  // Find the current chat config
  const currentChat = chats.find(chat => chat.chat_id === chatId);
  
  // 🔥 Check if it's a built-in agent (list differs by branding) - cannot be deleted
  const isBuiltinAgentFlag = isBuiltinAgent(currentChat?.agent?.name, BRAND_NAME);
  
  // Get the current primaryAgent
  const primaryAgent = data?.profile?.primaryAgent;
  
  // Check if the current Agent is already the Primary Agent
  const isPrimaryAgent = primaryAgent === currentChat?.agent?.name;
  
  // Handle duplicate Agent
  const handleDuplicateAgent = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (chatId && currentChat?.agent?.name) {
      onDuplicateAgent?.(chatId, currentChat.agent.name);
    }
    onClose?.();
  };
  
  // Handle setting as primary Agent
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
        const { profileDataManager } = await import('../../lib/userData');
        await profileDataManager.refresh();
        // Close menu
        onClose?.();
      } else {
        showError(`Failed to set primary agent: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      showError(`Failed to set primary agent: ${errorMessage}`);
    }
  };
  
  // 🔥 New: Import Chat Sessions state and handler
  const [isImporting, setIsImporting] = useState(false);
  
  const handleImportChatSessions = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    
    if (!chatId) {
      showError('Chat ID not found');
      return;
    }
    
    if (isImporting) {
      return; // Prevent duplicate clicks
    }
    
    try {
      setIsImporting(true);
      
      if (!window.electronAPI?.agentChat?.importAgentAssets) {
        showError('Import API not available');
        return;
      }
      
      const result = await window.electronAPI.agentChat.importAgentAssets(chatId);
      
      if (result.success) {
        const sessionsCount = result.importedSessions || 0;
        const workspaceFilesCount = result.importedWorkspaceFiles || 0;
        showSuccess(`Successfully imported ${sessionsCount} chat sessions and ${workspaceFilesCount} workspace files`);
        // Close menu
        onClose?.();
      } else {
        // No need to show error when user cancels file selection
        if (result.error !== 'File selection canceled') {
          showError(`Import failed: ${result.error || 'Unknown error'}`);
        }
        onClose?.();
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
      {onEditAgent && (
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
      )}
      {/* Only show this option when current Agent is not the Primary Agent */}
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
      {/* 🔥 Import Chat Sessions menu item: allows importing Chat Sessions and Workspace from a zip file */}
      <button
        className="dropdown-menu-item"
        onClick={handleImportChatSessions}
        disabled={isImporting}
        role="menuitem"
      >
        <span className="dropdown-menu-item-icon"><Upload size={16} strokeWidth={1.5} /></span>
        <span className="dropdown-menu-item-text">{isImporting ? 'Importing...' : 'Import Chat Sessions'}</span>
      </button>
      {/* Duplicate Agent menu item */}
      <button
        className="dropdown-menu-item"
        onClick={handleDuplicateAgent}
        role="menuitem"
      >
        <span className="dropdown-menu-item-icon"><Copy size={16} strokeWidth={1.5} /></span>
        <span className="dropdown-menu-item-text">Duplicate</span>
      </button>
      {/* Delete Agent menu item: only shown when not a built-in agent and not the Primary Agent */}
      {onDeleteAgent && !isBuiltinAgentFlag && !isPrimaryAgent && (
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

export default AgentDropdownMenu;