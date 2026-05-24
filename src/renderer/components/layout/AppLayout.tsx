import React, { useEffect, useCallback, useMemo, memo } from 'react';
import { LayoutProvider } from './LayoutProvider';
import { useProfileData } from '../userData/userDataProvider';
import { useCurrentChatId, agentChatSessionCacheManager } from '../../lib/chat/agentChatSessionCacheManager';
import { useToast } from '../ui/ToastProvider';
import { PasteToWorkspaceProvider } from '../chat/workspace/PasteToWorkspaceProvider';
import '../../styles/DropdownMenu.css';
import { createLogger } from '../../lib/utilities/logger';
import { AppLayoutContent } from './AppLayoutContent';
import { profileDataManager } from '../../lib/userData';
import { moveFileToKnowledgeBase } from '../../lib/chat/moveToKnowledgeBase';
import { DeleteConfirmAtom } from '../overlay/DeleteOverlay';
import { RenameChatSessionAtom } from '../overlay/RenameChatSessionOverlay';
import { ApplySkillDialogAtom } from '../skills/ApplySkillToAgentsDialog';
import ModifyMessageConfim from '../overlay/ModifyMsgConfimOverlay';

const logger = createLogger('[AppLayout]');

const AppLayout: React.FC = () => {
  // Delete confirmation dialog state (for agents and chat sessions)
  const deleteConfirmActions = DeleteConfirmAtom.useChange();
  // Rename chat session dialog state
  const renameChatSessionActions = RenameChatSessionAtom.useChange();

  // Delete confirmation handler
  const { data, chats } = useProfileData();
  const { showToast, showSuccess, showError } = useToast();

  const handleToggleChatSessionStar = useCallback(async (chatId: string, sessionId: string, starred: boolean) => {
    try {
      const profileCache = profileDataManager.getCache();
      const alias = profileCache?.profile?.alias;

      if (!alias) {
        showError('User not authenticated');
        return;
      }

      const result = await window.electronAPI?.profile?.setChatSessionStarred(
        alias,
        chatId,
        sessionId,
        starred,
      );

      if (result?.success) {
        showSuccess(starred ? 'Session starred' : 'Session unstarred');
      } else {
        showError(result?.error || 'Failed to update chat session star state');
      }
    } catch (error) {
      showError('Failed to update chat session star state');
    }
  }, [showError, showSuccess]);

  // Reactively get the current chatId; auto-updates when switching Agents
  const reactiveChatId = useCurrentChatId();

  // Get the knowledgeBase path for the current chat (used by the context menu)
  // Uses reactiveChatId as a dependency to ensure the path updates correctly after switching Agents
  const currentKnowledgeBasePath = useMemo(() => {
    if (!reactiveChatId || !data?.chats) return '';
    const currentChat = data.chats.find((chat: any) => chat.chat_id === reactiveChatId);
    return currentChat?.agent?.knowledge?.knowledgeBase || currentChat?.agent?.knowledgeBase || '';
  }, [reactiveChatId, data?.chats, data?.lastUpdated]);

  // Handle moving file to Agent Knowledge (uses generic function including path replacement logic)
  const handleFileTreeNodeMoveToKnowledge = useCallback(async (filePath: string) => {
    try {
      if (!currentKnowledgeBasePath) {
        logger.error('[FileTreeNode] No knowledge base path configured');
        window.alert('No knowledge base path configured for current agent.');
        return;
      }

      const result = await moveFileToKnowledgeBase(filePath, currentKnowledgeBasePath);

      if (!result.success && result.error && result.error !== 'User cancelled replacement') {
        const errMsg = result.error;
        const userMsg = errMsg.includes('EACCES')
          ? `Permission denied.\n\nThe app cannot access this file or folder. Please grant access in System Settings → Privacy & Security → Files and Folders, then try again.`
          : `Failed to move file: ${errMsg}`;
        window.alert(userMsg);
      }
    } catch (error) {
      logger.error('[FileTreeNode] Error moving file to knowledge:', error);
      const errMsg = error instanceof Error ? error.message : String(error);
      const userMsg = errMsg.includes('EACCES')
        ? `Permission denied.\n\nThe app cannot access this file or folder. Please grant access in System Settings → Privacy & Security → Files and Folders, then try again.`
        : `Failed to move file: ${errMsg}`;
      window.alert(userMsg);
    }
  }, [currentKnowledgeBasePath]);

  // Install skill from file tree node
  const installSkillActions = ApplySkillDialogAtom.useChange();


  const handleFileTreeNodeInstallSkill = useCallback(async (filePath: string) => {
    try {
      if (!window.electronAPI?.skillLibrary?.installSkillFromFilePath) {
        showError('Install skill API not available');
        return;
      }

      const result = await window.electronAPI.skillLibrary.installSkillFromFilePath(filePath, {
        chatId: reactiveChatId || undefined,
        applyToCurrentAgent: !!reactiveChatId,
        requestSource: 'file-tree',
      });

      if (result.success) {
        showSuccess(result.message || `Skill "${result.skillName}" installed successfully`);
        // Trigger skills list refresh
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('skills:refreshFolderExplorer', {
            detail: { skillName: result.skillName }
          }));
        }, 600);

        // Fall back to manual target selection only when current chat activation stays ambiguous.
        if (result.skillName && result.resolution === 'installed_but_needs_target_selection') {
          installSkillActions.setSkill(result.skillName);
        }
      } else if (result.error && result.error !== 'User cancelled the operation') {
        showToast(result.error, 'error', undefined, { persistent: true });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      showError(`Failed to install skill: ${errorMessage}`);
    }
  }, [reactiveChatId, showSuccess, showError, showToast]);

  // Handle showing delete confirmation dialog for chat sessions
  const handleShowDeleteChatSessionConfirm = useCallback(
    (sessionId: string) => {
      const currentSessionId =
        agentChatSessionCacheManager.getCurrentChatSessionId();
      const isCurrentSession = currentSessionId === sessionId;

      const currentChatId = agentChatSessionCacheManager.getCurrentChatId();
      const currentAgentChat = chats.find((c) => c.chat_id === currentChatId);
      const session = currentAgentChat?.chatSessions?.find(
        (s) => s.chatSession_id === sessionId,
      );
      const sessionTitle = session?.title || 'Unnamed Session';
      deleteConfirmActions.showChatSession(sessionId, sessionTitle, isCurrentSession);
    },
    [chats],
  );

  // Listen for delete events
  useEffect(() => {
    const handleDeleteChatSessionEvent = (event: CustomEvent) => {
      const { sessionId } = event.detail;
      handleShowDeleteChatSessionConfirm(sessionId);
    };

    const handleRenameChatSessionEvent = (event: CustomEvent) => {
      const { chatId, sessionId, title } = event.detail;
      renameChatSessionActions.show(chatId, sessionId, title);
    };

    const handleToggleChatSessionStarEvent = (event: CustomEvent) => {
      const { chatId, sessionId, starred } = event.detail;
      void handleToggleChatSessionStar(chatId, sessionId, starred);
    };

    window.addEventListener(
      'chatSession:delete',
      handleDeleteChatSessionEvent as EventListener,
    );
    window.addEventListener(
      'chatSession:rename',
      handleRenameChatSessionEvent as EventListener,
    );
    window.addEventListener(
      'chatSession:toggleStar',
      handleToggleChatSessionStarEvent as EventListener,
    );

    return () => {
      window.removeEventListener(
        'chatSession:delete',
        handleDeleteChatSessionEvent as EventListener,
      );
      window.removeEventListener(
        'chatSession:rename',
        handleRenameChatSessionEvent as EventListener,
      );
      window.removeEventListener(
        'chatSession:toggleStar',
        handleToggleChatSessionStarEvent as EventListener,
      );
    };
  }, [
    handleShowDeleteChatSessionConfirm,
    handleToggleChatSessionStar,
  ]);

  // 🔥 Listen for download ChatSession events
  useEffect(() => {
    const handleDownloadChatSessionEvent = async (event: Event) => {
      const customEvent = event as CustomEvent<{
        chatId: string;
        sessionId: string;
        title: string;
      }>;
      const { chatId, sessionId, title } = customEvent.detail;

      try {
        const profileCache = profileDataManager.getCache();
        const alias = profileCache?.profile?.alias;

        if (!alias) {
          showError('User not authenticated');
          return;
        }

        const result = await (window as any).electronAPI?.chatSessionOps?.downloadChatSession(
          alias,
          chatId,
          sessionId,
          title
        );

        if (result?.success && result?.filePath) {
          // Success: persistent toast + Open Folder button
          showToast(
            `Chat session saved as "${result.fileName}"`,
            'success',
            undefined,
            {
              persistent: true,
              actions: [
                {
                  label: 'Open Folder',
                  variant: 'primary' as const,
                  onClick: () => {
                    (window as any).electronAPI?.workspace?.showInFolder(result.filePath);
                  }
                }
              ]
            }
          );
        } else {
          // Failure: non-persistent toast
          showError(result?.error || 'Failed to download chat session');
        }
      } catch (error) {
        showError('Failed to download chat session');
      }
    };

    window.addEventListener(
      'chatSession:download',
      handleDownloadChatSessionEvent as EventListener,
    );

    return () => {
      window.removeEventListener(
        'chatSession:download',
        handleDownloadChatSessionEvent as EventListener,
      );
    };
  }, [showToast, showError]);

  useEffect(() => {
    const cleanup = window.electronAPI?.on('app:debugInfoDownloaded', (result: {
      success: boolean;
      filePath?: string;
      fileName?: string;
      error?: string;
    }) => {
      if (result?.success && result.filePath) {
        showToast(
          `Debug info saved as "${result.fileName || 'debug info zip'}"`,
          'success',
          undefined,
          {
            persistent: true,
            actions: [
              {
                label: 'Open Folder',
                variant: 'primary' as const,
                onClick: () => {
                  window.electronAPI?.workspace?.showInFolder(result.filePath!);
                }
              }
            ]
          }
        );
        return;
      }

      showError(result?.error || 'Failed to export debug info');
    });

    return cleanup;
  }, [showToast, showError]);

  return (
    <LayoutProvider>
      <PasteToWorkspaceProvider>
        <AppLayoutContent
          handleFileTreeNodeInstallSkill={handleFileTreeNodeInstallSkill}
          handleFileTreeNodeMoveToKnowledge={handleFileTreeNodeMoveToKnowledge}
          currentKnowledgeBasePath={currentKnowledgeBasePath}
        />
        <ModifyMessageConfim />
      </PasteToWorkspaceProvider>
    </LayoutProvider>
  );
};

export default memo(AppLayout);