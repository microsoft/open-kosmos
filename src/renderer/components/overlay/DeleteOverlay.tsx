import { atom } from '@/atom';
import { agentChatSessionCacheManager } from '@renderer/lib/chat/agentChatSessionCacheManager';
import { chatOps } from '@renderer/lib/chat/chatOps';
import { deleteChatSession } from '@renderer/lib/chat/chatSessionOps';
import { getPmAgentSayHiMessageConfig } from '@renderer/lib/chat/pmAgentSayHi';
import { startNewChatFor } from '@renderer/lib/chat/startNewChatFor';
import { profileDataManager } from '@renderer/lib/userData/profileDataManager';
import { createLogger } from '@renderer/lib/utilities/logger';

const logger = createLogger('[DeleteOverlay]');
import { useToast, type ToastContextType } from '../ui/ToastProvider';
import { type NavigateFunction, useNavigate, useLocation } from 'react-router-dom';

interface State {
  isOpen: boolean;
  type: 'agent' | 'chat-session';
  id: string | null;
  name: string | null;
  isCurrentSession?: boolean;
}

const zeroState: State = {
  isOpen: false,
  type: 'agent',
  id: null,
  name: null,
  isCurrentSession: false,
};

export const DeleteConfirmAtom = atom(zeroState, (get, set) => {
  function cancel() {
    set(zeroState);
  }

  function showAgent(id: string, name: string, isCurrentSession?: boolean) {
    set({ isOpen: true, type: 'agent', id, name, isCurrentSession });
  }

  function showChatSession(id: string, name: string, isCurrentSession?: boolean) {
    set({ isOpen: true, type: 'chat-session', id, name, isCurrentSession });
  }

  async function confirm(toast: ToastContextType, navigate: NavigateFunction, currentPath: string) {
    const { type, id, name, isCurrentSession } = get();
    if (!id) return;

    const { showError, showSuccess } = toast;
    try {
      if (type === 'agent') {
        // Fix: check if Agent switch is needed
        // 1. Check if the deleted chat is the current chat in cache manager
        const currentChatId = agentChatSessionCacheManager.getCurrentChatId();
        const isDeletingCurrentChat = id === currentChatId;

        // 2. New: check if the current route belongs to the deleted agent (handles deletion from settings page)
        const isOnDeletedAgentRoute = currentPath.includes(`/agent/chat/${id}`);

        // Switch condition: deleting the current chat, or current route belongs to the deleted agent
        const needsSwitch = isDeletingCurrentChat || isOnDeletedAgentRoute;

        logger.debug('Delete agent check:', {
          deletedChatId: id,
          currentChatId,
          isDeletingCurrentChat,
          currentPath,
          isOnDeletedAgentRoute,
          needsSwitch,
        });

        if (isDeletingCurrentChat) {
          // Step 1: Notify AgentPage to clean up current Agent
          window.dispatchEvent(
            new CustomEvent('agent:cleanup', {
              detail: { chatId: id, isDeletingCurrentChat: true },
            }),
          );
          await new Promise((resolve) => setTimeout(resolve, 100));
        }

        // Step 2: Execute delete operation
        const result = await chatOps.deleteChatConfig(id);

        if (result.success) {
          // Step 3: If switch needed, switch to Primary Agent
          if (needsSwitch) {
            // Get Primary Agent (from profile data)
            // Fix: refresh profile data to get the latest chats list
            await profileDataManager.refresh();
            const profileCache = profileDataManager.getCache();
            const primaryAgentName = profileCache?.profile?.primaryAgent || 'Kobi';

            // Fix: get chats from the latest profileCache, not from stale closure chats
            const latestChats = profileCache?.chats || [];
            const primaryAgentChat = latestChats.find(
              (c: any) => c.agent?.name === primaryAgentName,
            );
            const primaryAgentChatId = primaryAgentChat?.chat_id;

            logger.debug('Delete agent - switching to Primary Agent:', {
              deletedChatId: id,
              primaryAgentName,
              primaryAgentChatId,
              latestChatsCount: latestChats.length,
            });

            if (primaryAgentChatId) {
              // Fix: use startNewChatFor to switch to Primary Agent (unified API)
              const result = await startNewChatFor(
                primaryAgentChatId,
                getPmAgentSayHiMessageConfig(primaryAgentChatId),
              );
              logger.debug('startNewChatFor result:', result);

              if (result.success && result.chatSessionId) {
                // Fix: use the returned chatSessionId directly, no waiting needed
                logger.debug('Navigating to new agent route:', {
                  primaryAgentChatId,
                  newChatSessionId: result.chatSessionId,
                });
                navigate(`/agent/chat/${primaryAgentChatId}/${result.chatSessionId}`, { replace: true });
              } else {
                logger.error('Failed to start new chat for Primary Agent:', result);
              }
            } else {
              logger.error('Primary Agent not found:', {
                primaryAgentName,
                availableAgents: latestChats.map((c: any) => c.agent?.name),
              });
            }
          }
          // Fix: show success message after deletion
          showSuccess(
            `Agent "${name}" deleted successfully`,
          );
        } else {
          showError(
            `Failed to delete agent: ${result.error || 'Unknown error'}`,
          );
        }
      } else if (type === 'chat-session') {
        const currentChatId = agentChatSessionCacheManager.getCurrentChatId();
        if (!currentChatId) {
          showError('No current agent chat available');
          return;
        }

        const profileCache = profileDataManager.getCache();
        const profileAlias = profileCache?.profile?.alias;

        if (!profileAlias) {
          showError('No profile alias available');
          return;
        }

        // Fix: adjust delete order per design doc
        // Step 3: if deleting the CurrentChatSessionId, switch to a new session first
        if (isCurrentSession) {
          // 3a. Record the ChatSessionId to be deleted (already in deleteConfirmState.id)
          const deletingChatSessionId = id;

          // 3b. Switch to a new ChatSession via AgentChatManager.startNewChatFor
          // Note: must use startNewChatFor(chatId) not startNewChat()
          // startNewChat() only resets the current instance, does not create a new ChatSession
          if (currentChatId) {
            await startNewChatFor(
              currentChatId,
              getPmAgentSayHiMessageConfig(currentChatId),
            );
            // 3c. AgentChatManager.switchToChatSession will automatically call notifyCurrentChatSessionIdChanged
            //     The renderer's agentChatSessionCacheManager listens to the IPC event and auto-syncs currentChatId/currentChatSessionId
            // 3d. The renderer UI auto-renders via the useCurrentChatSessionId hook when data changes
          }
        }

        // Step 4: Delete the ChatSession for the corresponding chatSessionId
        // 4a. AgentChatManager deletes the corresponding AgentChat instance and registration
        if (window.electronAPI?.agentChat?.removeAgentChatInstance) {
          await window.electronAPI.agentChat.removeAgentChatInstance(id);
        }

        // 4b & 4c. ProfileCacheManager deletes metadata and local records, syncs to ProfileDataManager
        const deleteResult = await deleteChatSession(
          profileAlias,
          currentChatId,
          id,
        );
        if (!deleteResult.success) {
          showError(`Failed to delete session: ${deleteResult.error}`);
          return;
        }

        // 4d. ProfileDataManager returns to renderer
        await profileDataManager.refresh();

        showSuccess(
          `Session "${name}" deleted successfully`,
        );
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'An unknown error occurred';
      showError(`Failed to delete: ${errorMessage}`);
    } finally {
      set(zeroState);
    }
  }

  return { cancel, confirm, showAgent, showChatSession };
});

export function DeleteOverlay() {
  const [deleteConfirmState, actions] = DeleteConfirmAtom.use();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  if (!deleteConfirmState.isOpen) return null;
  return (
    <div className="delete-confirm-overlay">
      <div className="delete-confirm-modal">
        <div className="modal-header">
          <h2>
            {deleteConfirmState.type === 'agent' ? 'Delete Agent' : 'Delete Chat Session'}
          </h2>
        </div>
        <div className="modal-content">
          <p>Are you sure you want to delete <strong>{deleteConfirmState.name}</strong>?</p>
          <p className="warning-text">
            {deleteConfirmState.type === 'chat-session' && deleteConfirmState.isCurrentSession
              ? "This is the currently selected session. After deletion, it will switch to a new conversation. This action cannot be undone and all chat history will be permanently deleted."
              : "This action cannot be undone. All chat history will be permanently deleted."
            }
          </p>
        </div>
        <div className="modal-actions">
          <button className="btn-cancel" onClick={actions.cancel}>
            Cancel
          </button>
          <button
            className="btn-delete"
            onClick={() => actions.confirm(toast, navigate, location.pathname)}
          >
            {deleteConfirmState.type === 'agent' ? 'Delete Agent' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}

