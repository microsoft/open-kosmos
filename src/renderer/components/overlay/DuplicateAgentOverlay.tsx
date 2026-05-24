import { atom } from '@/atom';
import { chatOps } from '@renderer/lib/chat/chatOps';
import { profileDataManager } from '@renderer/lib/userData/profileDataManager';
import { useToast, type ToastContextType } from '../ui/ToastProvider';
import { useProfileData } from '../userData/userDataProvider';

interface State {
  isOpen: boolean;
  chatId: string | null;
  agentName: string | null;
  newName: string;
}

const zeroState: State = {
  isOpen: false,
  chatId: null,
  agentName: null,
  newName: '',
};

export const DuplicateAgentAtom = atom(zeroState, (get, set) => {
  function cancel() {
    set(zeroState);
  }

  function show(chatId: string, agentName: string) {
    set({ isOpen: true, chatId, agentName, newName: `${agentName} Copy` });
  }

  function setNewName(newName: string) {
    set({ ...get(), newName });
  }

  async function confirm(toast: ToastContextType) {
    const { chatId, newName } = get();

    if (!chatId || !newName.trim()) {
      toast.showError('Invalid agent data for duplication');
      set(zeroState);
      return;
    }

    try {
      const result = await chatOps.duplicateChatConfig(chatId, newName.trim());

      if (result.success) {
        const warnings: string[] = [];
        if (result.data?.knowledgeCopyFailed) warnings.push('knowledge files');
        if (result.data?.scheduleCopyFailed) warnings.push('scheduled tasks');

        if (warnings.length > 0) {
          toast.showWarning(`Agent "${newName.trim()}" created, but ${warnings.join(' and ')} could not be copied.`);
        } else {
          toast.showSuccess(`Agent "${newName.trim()}" created successfully!`);
        }
        set(zeroState);
        await profileDataManager.refresh();
      } else {
        toast.showError(result.error || 'Failed to duplicate agent');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      toast.showError(`Failed to duplicate agent: ${errorMessage}`);
    }
  }

  return { cancel, confirm, show, setNewName };
});

export function DuplicateAgentOverlay() {
  const [state, actions] = DuplicateAgentAtom.use();
  const toast = useToast();
  const { chats } = useProfileData();

  if (!state.isOpen) return null;

  const isDuplicateNameExists = state.newName.trim()
    ? chats.some(chat => chat.agent?.name?.toLowerCase() === state.newName.trim().toLowerCase())
    : false;

  return (
    <div className="delete-confirm-overlay">
      <div className="delete-confirm-modal duplicate-agent-modal">
        <div className="modal-header">
          <h2>Duplicate Agent</h2>
        </div>
        <div className="modal-content">
          <p>Enter a name for the copy of <strong>{state.agentName}</strong></p>
          <input
            type="text"
            className={`duplicate-agent-input ${isDuplicateNameExists ? 'warning' : ''}`}
            value={state.newName}
            onChange={(e) => actions.setNewName(e.target.value)}
            placeholder="Enter new agent name"
            autoFocus
          />
          {isDuplicateNameExists && (
            <div className="warning-message">⚠️ Agent name already exists</div>
          )}
        </div>
        <div className="modal-actions">
          <button className="btn-cancel" onClick={actions.cancel}>
            Cancel
          </button>
          <button
            className="btn-primary"
            onClick={() => actions.confirm(toast)}
            disabled={!state.newName.trim() || isDuplicateNameExists}
          >
            Duplicate
          </button>
        </div>
      </div>
    </div>
  );
}
