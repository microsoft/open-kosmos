import { atom } from '@/atom';
import { agentChatSessionCacheManager } from '@renderer/lib/chat/agentChatSessionCacheManager';
import { chatOps } from '@renderer/lib/chat/chatOps';
import { deleteChatSession } from '@renderer/lib/chat/chatSessionOps';
import { startNewChatFor } from '@renderer/lib/chat/startNewChatFor';
import { profileDataManager } from '@renderer/lib/userData/profileDataManager';
import { createLogger } from '@renderer/lib/utilities/logger';

const logger = createLogger('[DeleteOverlay]');
import { useToast, type ToastContextType } from '../ui/ToastProvider';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { type NavigateFunction, useNavigate, useLocation } from 'react-router-dom';
import { translate, type TranslationKey, type TranslationParams } from '../../lib/i18n';
import { useI18n } from '../../lib/i18n/useI18n';

type TFunction = (key: TranslationKey, params?: TranslationParams) => string;
const fallbackT: TFunction = (key, params) => translate('en', key, params);

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

  async function confirm(
    toast: ToastContextType,
    navigate: NavigateFunction,
    currentPath: string,
    t: TFunction = fallbackT,
  ) {
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
            // Get the primary chat (from profile data)
            // Fix: refresh profile data to get the latest chats list
            await profileDataManager.refresh();
            const profileCache = profileDataManager.getCache();
            const primaryChatId = profileCache?.profile?.primaryChat;

            // Fix: get chats from the latest profileCache, not from stale closure chats
            const latestChats = profileCache?.chats || [];
            // Resolve the primary chat by its stable chat_id; fall back to the first chat.
            const primaryAgentChat = latestChats.find(
              (c: any) => c.chat_id === primaryChatId,
            ) ?? latestChats[0];
            const primaryAgentChatId = primaryAgentChat?.chat_id;

            logger.debug('Delete agent - switching to Primary Agent:', {
              deletedChatId: id,
              primaryChatId,
              primaryAgentChatId,
              latestChatsCount: latestChats.length,
            });

            if (primaryAgentChatId) {
              // Fix: use startNewChatFor to switch to Primary Agent (unified API)
              const result = await startNewChatFor(primaryAgentChatId);
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
                primaryChatId,
                availableChatIds: latestChats.map((c: any) => c.chat_id),
              });
            }
          }
          // Fix: show success message after deletion
          showSuccess(
            t('overlay.delete.agentSuccess', { name }),
          );
        } else {
          showError(
            t('overlay.delete.failed', { error: result.error || t('common.unknownError') }),
          );
        }
      } else if (type === 'chat-session') {
        const currentChatId = agentChatSessionCacheManager.getCurrentChatId();
        if (!currentChatId) {
          showError(t('overlay.delete.noCurrentAgentChat'));
          return;
        }

        const profileCache = profileDataManager.getCache();
        const profileAlias = profileCache?.profile?.alias;

        if (!profileAlias) {
          showError(t('overlay.delete.noProfileAlias'));
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
            await startNewChatFor(currentChatId);
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
          showError(t('overlay.delete.sessionFailed', { error: deleteResult.error || t('common.unknownError') }));
          return;
        }

        // 4d. ProfileDataManager returns to renderer
        await profileDataManager.refresh();

        showSuccess(
          t('overlay.delete.sessionSuccess', { name }),
        );
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'An unknown error occurred';
      showError(t('overlay.delete.failed', { error: errorMessage }));
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
  const { t } = useI18n();

  return (
    <Dialog
      open={deleteConfirmState.isOpen}
      onOpenChange={() => actions.cancel()}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {deleteConfirmState.type === 'agent' ? t('overlay.delete.title') : t('overlay.delete.chatSessionTitle')}
          </DialogTitle>
        </DialogHeader>
        <div className="mt-2 space-y-2 text-sm text-neutral-600">
          <p>
            {t('overlay.delete.confirm')}{' '}
            <strong className="font-semibold text-neutral-900">{deleteConfirmState.name}</strong>?
          </p>
          <p className="text-neutral-500">
            {deleteConfirmState.type === 'chat-session' && deleteConfirmState.isCurrentSession
              ? t('overlay.delete.currentSessionWarning')
              : t('overlay.delete.warning')}
          </p>
        </div>
        <DialogFooter className="mt-6">
          <button className="btn-secondary" onClick={actions.cancel} type="button">
            {t('common.cancel')}
          </button>
          <button
            className="btn-danger"
            onClick={() => actions.confirm(toast, navigate, location.pathname, t)}
            type="button"
          >
            {t('common.delete')}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
