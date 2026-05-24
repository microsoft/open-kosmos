import { atom } from '@/atom';
import { profileDataManager } from '@renderer/lib/userData/profileDataManager';
import { useToast, type ToastContextType } from '../ui/ToastProvider';

interface State {
  isOpen: boolean;
  chatId: string | null;
  sessionId: string | null;
  newTitle: string;
}

const zeroState: State = {
  isOpen: false,
  chatId: null,
  sessionId: null,
  newTitle: '',
};

export const RenameChatSessionAtom = atom(zeroState, (get, set) => {
  function cancel() {
    set(zeroState);
  }

  function show(chatId: string, sessionId: string, title: string) {
    set({ isOpen: true, chatId, sessionId, newTitle: title });
  }

  function setNewTitle(newTitle: string) {
    set({ ...get(), newTitle });
  }

  async function confirm(toast: ToastContextType) {
    const { chatId, sessionId, newTitle } = get();

    if (!chatId || !sessionId || !newTitle.trim()) return;

    try {
      const profileCache = profileDataManager.getCache();
      const alias = profileCache?.profile?.alias;

      if (!alias) {
        toast.showError('User not authenticated');
        return;
      }

      const result = await window.electronAPI?.profile?.renameChatSession(
        alias,
        chatId,
        sessionId,
        newTitle.trim(),
      );

      if (result?.success) {
        toast.showSuccess('Chat session renamed successfully');
      } else {
        toast.showError(result?.error || 'Failed to rename chat session');
      }
    } catch (error) {
      toast.showError('Failed to rename chat session');
    } finally {
      set(zeroState);
    }
  }

  return { cancel, confirm, show, setNewTitle };
});

export function RenameChatSessionOverlay() {
  const [state, actions] = RenameChatSessionAtom.use();
  const toast = useToast();

  if (!state.isOpen) return null;
  return (
    <div className="delete-confirm-overlay">
      <div className="delete-confirm-modal duplicate-agent-modal">
        <div className="modal-header">
          <h2>Rename Chat Session</h2>
        </div>
        <div className="modal-content">
          <p>Enter a new name for this chat session</p>
          <input
            type="text"
            className="duplicate-agent-input"
            value={state.newTitle}
            onChange={(e) => actions.setNewTitle(e.target.value)}
            placeholder="Enter session name"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && state.newTitle.trim()) {
                actions.confirm(toast);
              }
            }}
          />
        </div>
        <div className="modal-actions">
          <button className="btn-cancel" onClick={actions.cancel}>
            Cancel
          </button>
          <button
            className="btn-primary"
            onClick={() => actions.confirm(toast)}
            disabled={!state.newTitle.trim()}
          >
            Rename
          </button>
        </div>
      </div>
    </div>
  );
}
