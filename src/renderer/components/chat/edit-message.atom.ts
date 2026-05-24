import { atom } from '@/atom';
import { ToastContextType } from '../ui/ToastProvider';
import { agentChatIpc } from '@/lib/chat/agentChatIpc';
import { Message, UserMessage } from '@shared/types/chatTypes';
import { agentChatSessionCacheManager } from '@/lib';


export interface EditingMessageState {
  chatSessionId: string;
  id: string;
  index: number;
  message: Message;
  warningMessage: string | null;
}

export const editMessageAtom = atom(null as (EditingMessageState | null), (get, set) => {
  function getAllMessages(chatSessionId: string): Message[] {
    const cache = agentChatSessionCacheManager.getChatSessionCache(chatSessionId);
    return cache?.messages || [];
  }

  async function start(
    chatSessionId: string,
    message: UserMessage,
    toast: ToastContextType,
  ) {
    const all = getAllMessages(chatSessionId);
    const index = all.findIndex((msg) => msg.id === message.id);
    if (index === -1) return;

    function checkTool(name?: string) {
      if (!name) return;
      const normalized = name.toLowerCase();
      return [
        'write', 'edit', 'update', 'modify', 'delete', 'remove', 'move', 'rename', 'copy', 'create',
        'install', 'execute', 'run', 'send', 'approve', 'apply', 'commit', 'publish',
      ].some((keyword) => normalized.includes(keyword));
    }

    function warning() {
      for (let i = index + 1; i < all.length; i += 1) {
        const item = all[i];
        if (item.role === 'assistant' && item.tool_calls?.some((toolCall) => checkTool(toolCall.function.name))) {
          return 'Regenerating will not undo external actions that were already executed.';
        }
        if (item.role === 'tool' && checkTool(item.name)) {
          return 'Regenerating will not undo external actions that were already executed.';
        }
      }
      return null;
    }

    const id = message.id;
    try {
      const validation = await agentChatIpc.canEditUserMessage(chatSessionId, id);
      if (!validation.canEdit) {
        toast.showToast(validation.error || 'This message can no longer be edited.', 'error', undefined, { persistent: true });
        return;
      }
      set({ chatSessionId, id, index, message, warningMessage: warning() });
    } catch (error) {
      toast.showToast(
        error instanceof Error ? error.message : 'Failed to validate whether this message can be edited.',
        'error',
        undefined,
        { persistent: true },
      );
    }
  }

  function cancel() {
    set(null);
  }

  async function save(updatedMessage: UserMessage) {
    const state = get();
    if (!state) return;
    const { chatSessionId, id, index } = state;

    const messages = getAllMessages(chatSessionId);
    const truncatedMessages: Message[] = [
      ...messages.slice(0, index),
      updatedMessage,
    ];

    agentChatSessionCacheManager.clearErrorMessage(chatSessionId);
    agentChatSessionCacheManager.replaceMessages(chatSessionId, truncatedMessages, {
      chatStatus: 'idle',
      streamingMessageId: null,
      pendingInteractiveRequest: null,
      errorMessage: null,
    });

    set(null);

    try {
      await agentChatIpc.editUserMessage(chatSessionId, id, updatedMessage);
    } catch (error) {
      agentChatSessionCacheManager.replaceMessages(chatSessionId, messages, {
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { start, cancel, save };
});
