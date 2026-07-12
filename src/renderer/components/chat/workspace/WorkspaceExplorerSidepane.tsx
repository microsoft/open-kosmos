import React, { useMemo, useCallback } from 'react';
import '../../../styles/Sidepane.css';
import '../../../styles/WorkspaceExplorerSidepane.css';
import { useProfileData } from '../../userData/userDataProvider';
import { useAuthContext } from '../../auth/AuthProvider';
import {
  updateChatWorkspace,
  updateChatKnowledgeBase,
} from '../../../lib/chat/workspaceOps';
import { extractMonthFromChatSessionIdValue } from '../../../../shared/utils/idFormats';
import { useCurrentChatSessionId, useCurrentChatId } from '../../../lib/chat/agentChatSessionCacheManager';
import { resolveChatAgent } from '@/lib/agent';
import FileExplorerSection from './FileExplorerSection';
import InlineFilePreviewPanel from '../InlineFilePreviewPanel';
import { WorkspaceMenuAtom } from '@renderer/components/menu/WorkspaceMenuDropdown';
import { WorkspaceExplorerAtom } from '../chat-side.atom';
import { useI18n } from '../../../lib/i18n/useI18n';

export interface WorkspaceMenuActions {
  onOpenInExplorer: () => void;
  onAddFiles: () => void;
  onAddFolder: () => void;
  onPasteToWorkspace: () => void;
  canOpenInExplorer: boolean;
  canAddFiles: boolean;
  canAddFolder: boolean;
  canPasteToWorkspace: boolean;
  workspacePath: string;
}

const WorkspaceExplorerSidepane: React.FC = () => {
  const { t } = useI18n();
  const [
    { visible: isVisible, mode, preview, reveal: revealRequest },
    workspaceActions,
  ] = WorkspaceExplorerAtom.use();
  const { cancelReveal: onRevealHandled } = workspaceActions;
  const { toggle: onMenuToggle } = WorkspaceMenuAtom.useChange();
  const { data } = useProfileData();
  // 🔧 Fix: use reactive hook instead of synchronous reads
  // Previously used require() + getCurrentChatId() directly, which is not reactive
  // After startNewChatFor completes, the sidebar would not re-render, causing knowledgeBase to show "Not initialized"
  const currentChatId = useCurrentChatId();
  const { user } = useAuthContext();
  const userAlias = user?.login;

  // Get current Chat's workspace and current Agent's KnowledgeBase from ProfileData
  const { currentWorkspace, currentKnowledgeBase } = useMemo(() => {
    if (!data?.chats || !currentChatId) {
      return {
        currentWorkspace: '',
        currentKnowledgeBase: '',
      };
    }
    const currentChat = data.chats.find(chat => chat.chat_id === currentChatId);
    const currentAgent = resolveChatAgent(currentChat);
    return {
      currentWorkspace: currentChat?.workspace || currentAgent?.workspace || '',
      currentKnowledgeBase: currentAgent?.knowledge?.knowledgeBase || currentAgent?.knowledgeBase || '',
    };
  }, [data.chats, data.lastUpdated, currentChatId]);

  // Get current ChatSessionId (reactive)
  const currentChatSessionId = useCurrentChatSessionId();

  // Compute current chat session file directory path: workspace/YYYYMM/chatSessionId
  const chatSessionFilePath = useMemo(() => {
    if (!currentWorkspace || !currentChatSessionId) return '';

    const yyyymm = extractMonthFromChatSessionIdValue(currentChatSessionId);
    if (!yyyymm) return '';
    // 🔥 Fix: use the same path separator as the workspace path (on Windows: \\)
    // Detect the separator used in the workspace path
    const sep = currentWorkspace.includes('\\') ? '\\' : '/';
    return `${currentWorkspace}${sep}${yyyymm}${sep}${currentChatSessionId}`;
  }, [currentWorkspace, currentChatSessionId]);

  // Default paths - fetched via IPC
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
          setDefaultKnowledgeBasePath(currentKnowledgeBase);
        }
      } catch (error) {
        // ignore
      }
    };

    getDefaultPaths();
  }, [currentChatId, userAlias, currentKnowledgeBase]);

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

  // Preview mode: a single file rendered by InlineFilePreviewPanel, splitting the
  // chat-content-wrapper like the legacy inline preview. The X always destroys the
  // sidepane; the back arrow (tree-origin only) returns to the file tree.
  if (mode === 'preview' && preview) {
    return (
      <>
        <div
          className="inline-preview-resizer"
          onMouseDown={workspaceActions.resizePreview}
        />
        <InlineFilePreviewPanel
          file={preview.file}
          isOpen
          onClose={() => workspaceActions.setVisible(false)}
          onBack={preview.origin === 'tree' ? workspaceActions.backToExplorer : undefined}
          onDirtyStateChange={workspaceActions.markPreviewDirty}
          style={preview.width != undefined ? { flex: `0 0 ${preview.width}px` } : undefined}
        />
      </>
    );
  }

  return (
    <div className="file-explorer-sidepane chat-sidepane">
      {/* Knowledge Base Section */}
      <FileExplorerSection
        title={t('workspace.explorer.agentKnowledgeFiles')}
        sectionClassName="knowledge-explorer-sidepane-section"
        currentPath={currentKnowledgeBase}
        defaultPath={defaultKnowledgeBasePath}
        currentChatId={currentChatId}
        revealRequest={revealRequest}
        onRevealHandled={onRevealHandled}
        onUpdatePath={handleUpdateKnowledgeBasePath}
        onMenuToggle={onMenuToggle}
      />

      {/* Chat Session File Section */}
      <FileExplorerSection
        title={t('workspace.explorer.currentSessionDeliverables')}
        sectionClassName="chat-session-file-explorer-sidepane-section"
        emptyMessage={t('workspace.explorer.currentSessionEmpty')}
        hideEmptyActions={true}
        currentPath={chatSessionFilePath}
        defaultPath={chatSessionFilePath}
        currentChatId={currentChatId}
        revealRequest={revealRequest}
        onRevealHandled={onRevealHandled}
        onUpdatePath={handleUpdateWorkspacePath}
        onMenuToggle={onMenuToggle}
        defaultSortField="mtime"
        defaultSortOrder="desc"
        showSortButton={true}
      />

    </div>
  );
};

export default WorkspaceExplorerSidepane;
