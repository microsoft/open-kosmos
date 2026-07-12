import { atom } from '@/atom';
import { UserMessage } from '@shared/types/chatTypes';
import { agentChatSessionCacheManager } from '@renderer/lib/chat/agentChatSessionCacheManager';
import { agentChatIpc } from '@renderer/lib/chat/agentChatIpc';

export interface QueuedMessageDraft {
  id: string;
  chatId: string;
  chatSessionId: string;
  message: UserMessage;
  createdAt: number;
  status: 'queued' | 'editing';
  pendingSteer?: boolean;
}

type QueuedMessageSessionState = {
  items: QueuedMessageDraft[];
};

type QueuedMessageState = Record<string, QueuedMessageSessionState | undefined>;

function getSessionItems(state: QueuedMessageState, chatSessionId: string | null | undefined): QueuedMessageDraft[] {
  if (!chatSessionId) {
    return [];
  }
  return state[chatSessionId]?.items ?? [];
}

function updateSessionItems(
  state: QueuedMessageState,
  chatSessionId: string,
  update: (items: QueuedMessageDraft[]) => QueuedMessageDraft[],
): QueuedMessageState {
  const nextItems = update(state[chatSessionId]?.items ?? []);
  const next = { ...state };
  if (nextItems.length === 0) {
    delete next[chatSessionId];
  } else {
    next[chatSessionId] = { items: nextItems };
  }
  return next;
}

export const queuedMessageAtom = atom({} as QueuedMessageState, (get, set) => {
  const steeringDraftIds = new Set<string>();
  let consumedCleanup: (() => void) | null = null;
  let cacheDestroyedCleanup: (() => void) | null = null;

  function syncQueueError(
    chatSessionId: string,
    action: Promise<void>,
    rollback?: () => void,
  ) {
    action.catch((error) => {
      // The optimistic renderer mutation already ran, but main rejected it, so the
      // renderer and main queues have diverged. Roll back the specific mutation
      // (targeted, never a full-state restore that could clobber a concurrent edit)
      // so a failed enqueue does not leave a ghost draft main never consumes and a
      // failed cancel/clear does not hide a prompt still queued in main.
      rollback?.();
      agentChatSessionCacheManager.setErrorMessage(
        chatSessionId,
        error instanceof Error ? error.message : String(error),
      );
    });
  }

  function ensureListeners() {
    if (typeof window === 'undefined') {
      return;
    }
    const api = window.electronAPI?.agentChat;
    if (!api) {
      return;
    }

    if (!consumedCleanup && api.onQueuedSteeringMessageConsumed) {
      consumedCleanup = api.onQueuedSteeringMessageConsumed((data) => {
        set((current) => updateSessionItems(
          current,
          data.chatSessionId,
          (items) => items.filter((item) => item.id !== data.messageId),
        ));
      });
    }

    // Main disposed this session's instance (idle-cleanup after ~5 min in the
    // background, tab close, etc.), which drops its in-memory steering queue. The
    // queue is ephemeral runtime state that is never persisted, so mirror main and
    // drop the renderer drafts too; otherwise they linger as ghosts main can never
    // consume, and editing+submitting one would silently no-op against the
    // recreated (empty) queue instead of being sent.
    if (!cacheDestroyedCleanup && api.onChatSessionCacheDestroyed) {
      cacheDestroyedCleanup = api.onChatSessionCacheDestroyed((data) => {
        set((current) => {
          if (!current[data.chatSessionId]) {
            return current;
          }
          const next = { ...current };
          delete next[data.chatSessionId];
          return next;
        });
      });
    }
  }

  function getForSession(chatSessionId: string | null | undefined): QueuedMessageDraft[] {
    return getSessionItems(get(), chatSessionId);
  }

  function queue(chatId: string | null | undefined, chatSessionId: string | null | undefined, message: UserMessage) {
    if (!chatId || !chatSessionId) {
      return;
    }

    ensureListeners();
    const draftId = `queued_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const queuedMessage = { ...message, id: draftId };
    set((current) => updateSessionItems(current, chatSessionId, (items) => [
      ...items,
      {
        id: draftId,
        chatId,
        chatSessionId,
        message: queuedMessage,
        createdAt: Date.now(),
        status: 'queued',
      },
    ]));
    syncQueueError(
      chatSessionId,
      agentChatIpc.enqueueQueuedSteeringMessage(chatSessionId, queuedMessage),
      // Enqueue failed: remove the ghost draft main never accepted.
      () => set((current) => updateSessionItems(
        current,
        chatSessionId,
        (items) => items.filter((item) => item.id !== draftId),
      )),
    );
  }

  function cancel(chatSessionId: string | null | undefined, draftId: string) {
    if (!chatSessionId) {
      return;
    }

    const priorItems = getSessionItems(get(), chatSessionId);
    const removedIndex = priorItems.findIndex((item) => item.id === draftId);
    const removedDraft = removedIndex >= 0 ? priorItems[removedIndex] : undefined;

    set((current) => updateSessionItems(
      current,
      chatSessionId,
      (items) => items.filter((item) => item.id !== draftId),
    ));
    syncQueueError(
      chatSessionId,
      agentChatIpc.removeQueuedSteeringMessage(chatSessionId, draftId),
      // Remove failed: the prompt is still queued in main, so re-insert the draft
      // near its original position instead of hiding it from the user. Only this
      // catch re-adds the draft (ids are unique and it runs at most once), so a
      // plain splice cannot duplicate it.
      removedDraft
        ? () => set((current) => updateSessionItems(current, chatSessionId, (items) => {
          const next = [...items];
          next.splice(Math.min(removedIndex, next.length), 0, removedDraft);
          return next;
        }))
        : undefined,
    );
  }

  function clearSession(chatSessionId: string | null | undefined) {
    if (!chatSessionId) {
      return;
    }

    const priorItems = getSessionItems(get(), chatSessionId);
    set((current) => {
      const next = { ...current };
      delete next[chatSessionId];
      return next;
    });
    syncQueueError(
      chatSessionId,
      agentChatIpc.clearQueuedSteeringMessages(chatSessionId),
      // Clear failed: the prompts are still queued in main. Restore the snapshot,
      // but only if the user has not queued new drafts since (avoid clobbering).
      priorItems.length > 0
        ? () => set((current) => {
          if (getSessionItems(current, chatSessionId).length > 0) {
            return current;
          }
          return updateSessionItems(current, chatSessionId, () => priorItems);
        })
        : undefined,
    );
  }

  function startEdit(chatSessionId: string, draftId: string) {
    set((current) => updateSessionItems(
      current,
      chatSessionId,
      (items) => items.map((item) => (
        {
          ...item,
          status: item.id === draftId ? 'editing' : 'queued',
          pendingSteer: item.id === draftId ? item.pendingSteer : false,
        }
      )),
    ));
    // Hold the draft in main so its drain (end-of-turn / idle pump) cannot consume
    // and send the stale pre-edit content while the user is still editing. Main
    // holds at most one id, so this also releases any previously-edited draft when
    // the edit target switches. No optimistic rollback: a failure just means main
    // could not hold it, and the surfaced error tells the user; forcing the draft
    // out of 'editing' would yank the in-progress edit out of the composer.
    syncQueueError(
      chatSessionId,
      agentChatIpc.setQueuedSteeringMessageEditing(chatSessionId, draftId, true),
    );
  }

  function cancelEdit(chatSessionId: string, draftId: string) {
    set((current) => updateSessionItems(
      current,
      chatSessionId,
      (items) => items.map((item) => (
        item.id === draftId && item.status === 'editing'
          ? { ...item, status: 'queued', pendingSteer: false }
          : item
      )),
    ));
    // Release the main-side hold so the drain can consume the draft again (and, if
    // the session is idle, main re-pumps it immediately).
    syncQueueError(
      chatSessionId,
      agentChatIpc.setQueuedSteeringMessageEditing(chatSessionId, draftId, false),
    );
  }

  async function submitEdit(chatSessionId: string, draftId: string, message: UserMessage) {
    const editingDraft = getSessionItems(get(), chatSessionId).find((item) => item.id === draftId);
    if (!editingDraft) {
      return;
    }

    const queuedMessage = { ...message, id: draftId };
    const priorMessage = editingDraft.message;
    const priorStatus = editingDraft.status;
    const shouldSteer = editingDraft.pendingSteer;
    set((current) => updateSessionItems(
      current,
      chatSessionId,
      (items) => items.map((item) => (
        item.id === draftId
          ? { ...item, message: queuedMessage, status: 'queued' }
          : item
      )),
    ));

    // When the edit also carries a queued Steer, promote the draft to the FIFO
    // head BEFORE sending the content update, not after. The draft is still held
    // in main here (the edit hold is released only by the update below), so this
    // promote's idle drain skips it — a held head is invisible to the drain, which
    // stops at it and consumes nothing, so no stale pre-edit content is sent — and
    // it simply moves the draft to the head. If the content update were sent first,
    // its idle re-pump would drain from the CURRENT head (an earlier-queued prompt
    // left behind by a cancelled turn) and start THAT prompt running before the
    // steer could promote this one, sending the wrong prompt next. Promoting first,
    // then releasing the hold via the update (which pumps), guarantees the steered
    // draft is the head the pump consumes first. While a turn is running the promote
    // is a no-op reorder and the update carries the new content into place for the
    // end-of-turn drain, so this ordering is correct whether idle or busy.
    if (shouldSteer) {
      await steerNow(chatSessionId, draftId);
    }

    syncQueueError(
      chatSessionId,
      agentChatIpc.updateQueuedSteeringMessage(chatSessionId, queuedMessage),
      // Update failed: restore the draft's prior content/status so the renderer
      // still matches the prompt main actually has queued.
      () => set((current) => updateSessionItems(
        current,
        chatSessionId,
        (items) => items.map((item) => (
          item.id === draftId
            ? { ...item, message: priorMessage, status: priorStatus }
            : item
        )),
      )),
    );
  }

  async function steerNow(chatSessionId: string, draftId: string) {
    const steeringKey = `${chatSessionId}:${draftId}`;
    if (steeringDraftIds.has(steeringKey)) {
      return;
    }

    const draft = getSessionItems(get(), chatSessionId).find((item) => item.id === draftId);
    if (!draft) {
      return;
    }

    if (draft.status === 'editing') {
      set((current) => updateSessionItems(
        current,
        chatSessionId,
        (items) => items.map((item) => (
          item.id === draftId ? { ...item, pendingSteer: true } : item
        )),
      ));
      return;
    }

    steeringDraftIds.add(steeringKey);
    try {
      await agentChatIpc.steerQueuedSteeringMessage(chatSessionId, draft.id);
    } catch (error) {
      agentChatSessionCacheManager.setErrorMessage(
        chatSessionId,
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      steeringDraftIds.delete(steeringKey);
    }
  }

  return { getForSession, queue, cancel, clearSession, startEdit, cancelEdit, submitEdit, steerNow };
});
