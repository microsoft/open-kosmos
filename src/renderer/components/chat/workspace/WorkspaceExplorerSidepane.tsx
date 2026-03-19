import React, { useMemo, useCallback } from 'react';
import '../../../styles/Sidepane.css';
import '../../../styles/WorkspaceExplorerSidepane.css';
import { useProfileData } from '../../userData/userDataProvider';
import { useAuthContext } from '../../auth/AuthProvider';
import {
  updateChatWorkspace,
  updateChatKnowledgeBase,
} from '../../../lib/chat/workspaceOps';
import { useCurrentChatSessionId, useCurrentChatId } from '../../../lib/chat/agentChatSessionCacheManager';
import FileExplorerSection from './FileExplorerSection';

interface WorkspaceExplorerSidepaneProps {
  isVisible: boolean;
  onClose: () => void;
  onMenuToggle?: (buttonElement: HTMLElement, menuActions: WorkspaceMenuActions) => void;
  menuState?: {
    isOpen: boolean;
    position: { top: number; left: number } | null;
  };
  onFileTreeNodeMenuToggle?: (event: React.MouseEvent, node: any, workspacePath: string) => void;
}

export interface WorkspaceMenuActions {
  onOpenInExplorer: () => void;
  onAddFiles: () => void;
  onAddFolder: () => void;
  onPasteToWorkspace: () => void;
  canOpenInExplorer: boolean;
  canAddFiles: boolean;
  canAddFolder: boolean;
  canPasteToWorkspace: boolean;
}

const WorkspaceExplorerSidepane: React.FC<WorkspaceExplorerSidepaneProps> = ({
  isVisible,
  onClose,
  onMenuToggle,
  menuState,
  onFileTreeNodeMenuToggle
}) => {
  const { data } = useProfileData();
  // 🔧 Fix: use reactive hook instead of synchronous read
  // Previously used require() + getCurrentChatId() for direct read, which was not reactive
  // This caused the sidebar not to re-render after startNewChatFor completes, showing "Not initialized" for knowledgeBase
  const currentChatId = useCurrentChatId();
  const { user } = useAuthContext();
  const userAlias = user?.login;

  // Get current Agent's Workspace and KnowledgeBase from ProfileData
  const { currentWorkspace, currentKnowledgeBase } = useMemo(() => {
    if (!data?.chats || !currentChatId) {
      return { currentWorkspace: '', currentKnowledgeBase: '' };
    }
    const currentChat = data.chats.find(chat => chat.chat_id === currentChatId);
    return {
      currentWorkspace: currentChat?.agent?.workspace || '',
      currentKnowledgeBase: currentChat?.agent?.knowledgeBase || '',
    };
  }, [data.chats, data.lastUpdated, currentChatId]);

  // Get current ChatSessionId (reactive)
  const currentChatSessionId = useCurrentChatSessionId();

  // Calculate current chat session file directory path: workspace/YYYYMM/chatSessionId
  const chatSessionFilePath = useMemo(() => {
    if (!currentWorkspace || !currentChatSessionId) return '';

    // Extract YYYYMM from chatSessionId (format: chatSession_YYYYMMDDHHmmss)
    const match = currentChatSessionId.match(/^chatSession_(\d{4})(\d{2})/);
    if (!match) return '';

    const yyyymm = `${match[1]}${match[2]}`;
    // 🔥 Fix: use separator consistent with workspace path (\\ on Windows)
    // Detect the separator used in the workspace path
    const sep = currentWorkspace.includes('\\') ? '\\' : '/';
    return `${currentWorkspace}${sep}${yyyymm}${sep}${currentChatSessionId}`;
  }, [currentWorkspace, currentChatSessionId]);

  // Default paths - obtained via IPC
  const [defaultWorkspacePath, setDefaultWorkspacePath] = React.useState<string>('');
  const [defaultKnowledgeBasePath, setDefaultKnowledgeBasePath] = React.useState<string>('');

  React.useEffect(() => {
    if (!currentChatId || !userAlias) {
      setDefaultWorkspacePath('');
      setDefaultKnowledgeBasePath('');
      return;
    }

    const getDefaultPaths = async () => {
      try {
        const result = await (window as any).electronAPI.workspace.getDefaultWorkspacePath?.(userAlias, currentChatId);
        if (result?.success && result?.data) {
          setDefaultWorkspacePath(result.data);
          // Knowledge base default path is workspace/knowledge
          setDefaultKnowledgeBasePath(result.data + '/knowledge');
        }
      } catch (error) {
        // ignore
      }
    };

    getDefaultPaths();
  }, [currentChatId, userAlias]);

  // Update Workspace path
  const handleUpdateWorkspacePath = useCallback(async (newPath: string) => {
    if (!currentChatId) return;
    await updateChatWorkspace(currentChatId, newPath);
  }, [currentChatId]);

  // Update KnowledgeBase path
  const handleUpdateKnowledgeBasePath = useCallback(async (newPath: string) => {
    if (!currentChatId) return;
    await updateChatKnowledgeBase(currentChatId, newPath);
  }, [currentChatId]);

  if (!isVisible) {
    return null;
  }

  return (
    <div className="file-explorer-sidepane chat-sidepane">
      {/* Knowledge Base Section */}
      <FileExplorerSection
        title="Agent Knowledge Files"
        sectionClassName="knowledge-explorer-sidepane-section"
        currentPath={currentKnowledgeBase}
        defaultPath={defaultKnowledgeBasePath}
        currentChatId={currentChatId}
        onUpdatePath={handleUpdateKnowledgeBasePath}
        onMenuToggle={onMenuToggle}
        onFileTreeNodeMenuToggle={onFileTreeNodeMenuToggle}
      />

      {/* Chat Session File Section */}
      <FileExplorerSection
        title="Current Chat Session Deliverables"
        sectionClassName="chat-session-file-explorer-sidepane-section"
        emptyMessage="Files generated during the current chat session will appear here."
        hideEmptyActions={true}
        currentPath={chatSessionFilePath}
        defaultPath={chatSessionFilePath}
        currentChatId={currentChatId}
        onUpdatePath={handleUpdateWorkspacePath}
        onMenuToggle={onMenuToggle}
        onFileTreeNodeMenuToggle={onFileTreeNodeMenuToggle}
      />
    </div>
  );
};

export default WorkspaceExplorerSidepane;
