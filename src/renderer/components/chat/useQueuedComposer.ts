import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Message, MessageHelper, UserMessage } from '@shared/types/chatTypes';
import { queuedMessageAtom, QueuedMessageDraft } from './queued-message.atom';

interface QueuedComposerTextareaManager {
  set: (value: string) => void;
}

interface QueuedComposerAttachmentManager {
  clear: () => void;
  loadFromMessage: (message: Message) => void;
}

export interface UseQueuedComposerOptions {
  chatSessionId: string | null | undefined;
  currentChatId: string | null;
  canQueueWhenBusy?: boolean;
  isEditMode: boolean;
  sessionIdle: boolean;
  queuedMessages: QueuedMessageDraft[];
  onSendMessage: (message: UserMessage) => void;
  attachmentManager: QueuedComposerAttachmentManager;
  textareaManager: QueuedComposerTextareaManager;
  textareaRef: { current: HTMLTextAreaElement | null };
  onComposeCleared?: () => void;
  onQueuedEditCleared?: () => void;
}

export interface UseQueuedComposerResult {
  editingQueuedMessageId: string | null;
  pendingQueueStartMessage: UserMessage | null;
  submitComposeMessage: (messageToSend: UserMessage) => Promise<void>;
  submitPendingQueueStartMessage: (shouldClearQueue: boolean) => void;
  cancelPendingQueueStart: () => void;
}

/**
 * Owns the queued-steering composer lifecycle for ChatInput: which queued draft
 * is currently being edited, the "start with queued prompts?" confirmation,
 * loading a draft back into the composer when the user hits Edit, and clearing
 * the composer when the chat session changes. Extracted from ChatInput to keep
 * that component within the file-length budget and to make the queue lifecycle
 * independently testable.
 */
export function useQueuedComposer(options: UseQueuedComposerOptions): UseQueuedComposerResult {
  const {
    chatSessionId,
    currentChatId,
    canQueueWhenBusy = true,
    isEditMode,
    sessionIdle,
    queuedMessages,
    onSendMessage,
    attachmentManager,
    textareaManager,
    textareaRef,
    onComposeCleared,
    onQueuedEditCleared,
  } = options;

  const queuedMessageActions = queuedMessageAtom.useChange();
  const [editingQueuedMessageId, setEditingQueuedMessageId] = useState<string | null>(null);
  const [pendingQueueStartMessage, setPendingQueueStartMessage] = useState<UserMessage | null>(null);

  const focusComposer = useCallback(() => {
    textareaRef.current?.focus();
  }, [textareaRef]);

  const clearComposer = useCallback(() => {
    textareaManager.set('');
    attachmentManager.clear();
    onComposeCleared?.();
    focusComposer();
  }, [attachmentManager, focusComposer, onComposeCleared, textareaManager]);

  const clearQueuedEditComposer = useCallback(() => {
    attachmentManager.clear();
    if (onQueuedEditCleared) {
      onQueuedEditCleared();
    } else {
      textareaManager.set('');
    }
    focusComposer();
  }, [attachmentManager, focusComposer, onQueuedEditCleared, textareaManager]);

  const queuedMessageEditing = useMemo(() => {
    if (isEditMode) {
      return null;
    }
    return queuedMessages.find((item) => item.status === 'editing') ?? null;
  }, [isEditMode, queuedMessages]);

  const loadedQueuedEditIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!queuedMessageEditing) {
      loadedQueuedEditIdRef.current = null;
      if (editingQueuedMessageId) {
        setEditingQueuedMessageId(null);
        clearQueuedEditComposer();
      }
      return;
    }

    if (loadedQueuedEditIdRef.current === queuedMessageEditing.id) {
      return;
    }

    loadedQueuedEditIdRef.current = queuedMessageEditing.id;
    setEditingQueuedMessageId(queuedMessageEditing.id);
    attachmentManager.loadFromMessage(queuedMessageEditing.message);
    textareaManager.set(MessageHelper.getText(queuedMessageEditing.message));
    setTimeout(focusComposer, 0);
  }, [attachmentManager, clearQueuedEditComposer, editingQueuedMessageId, focusComposer, queuedMessageEditing, textareaManager]);

  const previousChatSessionIdRef = useRef<string | null | undefined>(chatSessionId);
  useEffect(() => {
    if (previousChatSessionIdRef.current === chatSessionId) {
      return;
    }
    previousChatSessionIdRef.current = chatSessionId;
    // A pending "start with queued prompts?" confirmation is scoped to the session
    // that raised it: its message and queue belong to the previous session. Clear it
    // on any session switch (regardless of edit mode) so confirming after switching
    // cannot send the old session's prompt into the new one or clear the new
    // session's queue.
    setPendingQueueStartMessage(null);
    if (!isEditMode) {
      setEditingQueuedMessageId(null);
      loadedQueuedEditIdRef.current = null;
      attachmentManager.clear();
      textareaManager.set('');
    }
  }, [attachmentManager, chatSessionId, isEditMode, textareaManager]);

  const submitComposeMessage = useCallback(async (messageToSend: UserMessage) => {
    if (editingQueuedMessageId && chatSessionId) {
      await queuedMessageActions.submitEdit(chatSessionId, editingQueuedMessageId, messageToSend);
      setEditingQueuedMessageId(null);
      loadedQueuedEditIdRef.current = null;
      clearQueuedEditComposer();
      return;
    }

    if (!sessionIdle) {
      if (!canQueueWhenBusy) {
        return;
      }
      queuedMessageActions.queue(currentChatId, chatSessionId, messageToSend);
      clearComposer();
      return;
    }

    if (chatSessionId && queuedMessages.length > 0 && !pendingQueueStartMessage) {
      setPendingQueueStartMessage(messageToSend);
      return;
    }

    onSendMessage(messageToSend);
    clearComposer();
  }, [
    canQueueWhenBusy,
    chatSessionId,
    clearComposer,
    clearQueuedEditComposer,
    currentChatId,
    editingQueuedMessageId,
    onSendMessage,
    pendingQueueStartMessage,
    queuedMessageActions,
    queuedMessages,
    sessionIdle,
  ]);

  const submitPendingQueueStartMessage = useCallback((shouldClearQueue: boolean) => {
    if (!pendingQueueStartMessage) {
      return;
    }
    // A pending start-message is only ever set for a truthy chatSessionId and is
    // cleared the moment the session changes (see the session-change effect above),
    // so chatSessionId is guaranteed to still be that same session here. clearSession
    // is null-safe regardless, so no extra chatSessionId guard is needed.
    if (shouldClearQueue) {
      queuedMessageActions.clearSession(chatSessionId);
    }
    onSendMessage(pendingQueueStartMessage);
    clearComposer();
    setPendingQueueStartMessage(null);
  }, [
    chatSessionId,
    clearComposer,
    onSendMessage,
    pendingQueueStartMessage,
    queuedMessageActions,
  ]);

  const cancelPendingQueueStart = useCallback(() => {
    setPendingQueueStartMessage(null);
    focusComposer();
  }, [focusComposer]);

  return {
    editingQueuedMessageId,
    pendingQueueStartMessage,
    submitComposeMessage,
    submitPendingQueueStartMessage,
    cancelPendingQueueStart,
  };
}
