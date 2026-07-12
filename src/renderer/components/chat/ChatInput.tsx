import React, { useState, useRef, useEffect, useCallback } from 'react';
import { profileDataManager } from '../../lib/userData/profileDataManager';
import { agentChatSessionCacheManager, CurrentSessionError, CurrentSessionIdle } from '../../lib/chat/agentChatSessionCacheManager';
import { Message, MessageHelper, UserMessage } from '@shared/types/chatTypes';
import ErrorBar from './ErrorBar';
import { useFeatureFlag } from '../../lib/featureFlags';
import { useVoiceInputEnabled } from '../../lib/userData';
import { getChatInputShortcutHint } from '../../lib/chat/chatInputKeyboard';
import '../../styles/ChatInput.css';
import { createLogger } from '../../lib/utilities/logger';
import { createAttachmentsAtom } from './chat-input/Attachments';
import { createTextareaAtom } from './chat-input/Textarea';
import { ChatInputControls } from './chat-input/ChatInputControls';
import { useChatInputAttachments } from './chat-input/useChatInputAttachments';
import { atom } from '@/atom';
import { useToast } from '../ui/ToastProvider';
import { agentChatIpc } from '@renderer/lib/chat/agentChatIpc';
import { EditAgentMenuAtom } from '../menu/EditAgentMenuDropdown';
import { AttachMenuAtom } from '../menu/AttachMenuDropdown';
import { chatSessionInputDraftManager } from '../../lib/chat/chatSessionInputDraftManager';
import { QueuedMessageDraft } from './queued-message.atom';
import QueuedMessageList from './QueuedMessageList';
import QueuedMessageStartDialog from './QueuedMessageStartDialog';
import { useQueuedComposer } from './useQueuedComposer';
import { normalizeComposerMentions } from './composerMentions';
import { useI18n } from '../../lib/i18n/useI18n';

const logger = createLogger('[ChatInput]');

interface ChatInputProps {
  onSendMessage: (message: UserMessage) => void;
  enableContextMenu?: boolean;
  // ErrorBar-related props
  chatSessionId?: string | null;
  // Lock interactions while keeping the compose UI visible (used during inline edit mode)
  isInputLocked?: boolean;
  // Inline edit mode for a selected user message
  mode?: 'compose' | 'edit-inline';
  initialMessage?: Message | null;
  onSubmitEditedMessage?: (message: UserMessage) => Promise<void> | void;
  onCancelEdit?: () => void;
  warningMessage?: string | null;
  queuedMessages?: QueuedMessageDraft[];
}

const ChatInput: React.FC<ChatInputProps> = ({
  onSendMessage,
  enableContextMenu,
  // ErrorBar-related props
  chatSessionId,
  isInputLocked = false,
  mode = 'compose',
  initialMessage = null,
  onSubmitEditedMessage,
  onCancelEdit,
  warningMessage,
  queuedMessages = [],
}) => {
  const errorMessage = CurrentSessionError.use();
  const isEditMode = mode === 'edit-inline';
  const editAgentMenuActions = EditAgentMenuAtom.useChange();
  const attachMenuActions = AttachMenuAtom.useChange();
  const textareaStateAtom = React.useMemo(() => createTextareaAtom(), []);
  const attachmentsStateAtom = React.useMemo(() => createAttachmentsAtom(), []);
  const validInputAtom = React.useMemo(() => atom((use) => {
    return use(attachmentsStateAtom).length > 0 || use(textareaStateAtom).trim().length > 0;
  }), [attachmentsStateAtom, textareaStateAtom]);
  const shouldLockComposeUi = !isEditMode && isInputLocked;
  const textareaManager = textareaStateAtom.useChange();
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false);
  const [isAwaitingEditConfirmation, setIsAwaitingEditConfirmation] = useState(false);
  const { t } = useI18n();
  // Voice Input is controlled by a feature flag and must be enabled in Settings
  const enableVoiceInput = useFeatureFlag('openkosmosFeatureVoiceInput');
  const voiceInputUserEnabled = useVoiceInputEnabled();
  const chatInputShortcutHint = getChatInputShortcutHint(
    typeof navigator === 'undefined' ? undefined : navigator.platform,
  );

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Unified attachment manager instance
  const attachmentManager = attachmentsStateAtom.useChange();
  const sessionIdle = CurrentSessionIdle.use();

  // Fully based on profileDataManager and currentChatId
  // Get currentChatId from agentChatSessionCacheManager
  const [currentChatId, setCurrentChatId] = useState<string | null>(
    agentChatSessionCacheManager.getCurrentChatId()
  );

  const hasValidInput = validInputAtom.use();
  const [supportsImages, setSupportsImages] = useState(false);
  const { showToast } = useToast();
  const saveComposeDraft = useCallback((text: string) => {
    if (!isEditMode) {
      chatSessionInputDraftManager.set(chatSessionId, text);
    }
  }, [chatSessionId, isEditMode]);
  const clearComposeDraft = useCallback(() => {
    if (!isEditMode) {
      chatSessionInputDraftManager.clear(chatSessionId);
      profileDataManager.setCurrentEditingPrompt('');
    }
  }, [chatSessionId, isEditMode]);
  const restoreComposeDraft = useCallback(() => {
    if (!isEditMode) {
      const draft = chatSessionInputDraftManager.get(chatSessionId);
      textareaManager.set(draft);
      profileDataManager.setCurrentEditingPrompt(draft);
    }
  }, [chatSessionId, isEditMode, textareaManager]);

  // External agents only support text and do not run the local queued-steering drain.
  const isExternalAgent = React.useMemo(() => {
    if (!currentChatId) return false;
    const agent = profileDataManager.getCurrentAgent();
    return agent?.source === 'EXTERNAL';
  }, [currentChatId]);

  const {
    editingQueuedMessageId,
    pendingQueueStartMessage,
    submitComposeMessage,
    submitPendingQueueStartMessage,
    cancelPendingQueueStart,
  } = useQueuedComposer({
    chatSessionId,
    currentChatId,
    canQueueWhenBusy: !isExternalAgent,
    isEditMode,
    sessionIdle,
    queuedMessages,
    onSendMessage,
    attachmentManager,
    textareaManager,
    textareaRef,
    onComposeCleared: clearComposeDraft,
    onQueuedEditCleared: restoreComposeDraft,
  });

  const handleDraftChange = useCallback((text: string) => {
    if (editingQueuedMessageId) {
      return;
    }
    saveComposeDraft(text);
  }, [editingQueuedMessageId, saveComposeDraft]);

  async function onCancelChat() {
    try {
      logger.debug('[ChatInput] 🛑 Cancelling chat...');

      if (!currentChatId) {
        logger.warn('[ChatInput] No current chat ID to cancel');
        showToast(t('chat.input.noActiveChatToCancel'), 'warning');
        return;
      }

      await agentChatIpc.cancelChat(currentChatId);

      logger.debug('[ChatInput] ✅ Chat cancelled successfully');
    } catch (error) {
      logger.error('[ChatInput] ❌ Error cancelling chat:', error);
    }
  }

  const effectiveSupportsImages = supportsImages && !isExternalAgent;

  // Watch for currentChatId changes
  useEffect(() => {
    const unsubscribe = agentChatSessionCacheManager.subscribeToCurrentChatSessionId(() => {
      const newChatId = agentChatSessionCacheManager.getCurrentChatId();
      setCurrentChatId(newChatId);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!isEditMode || !initialMessage) {
      return;
    }

    attachmentManager.loadFromMessage(initialMessage);
    textareaManager.set(MessageHelper.getText(initialMessage));
  }, [attachmentManager, initialMessage, isEditMode]);

  useEffect(() => {
    if (isEditMode) {
      return;
    }

    const draft = chatSessionInputDraftManager.get(chatSessionId);
    textareaManager.set(draft);
    profileDataManager.setCurrentEditingPrompt(draft);
  }, [chatSessionId, isEditMode, textareaManager]);

  useEffect(() => {
    return () => {
      attachmentManager.clear();
      textareaManager.set('');
    };
  }, [attachmentManager, textareaManager]);


  const {
    isDragOver,
    isProcessing,
    handleDragOver,
    handleDragEnter,
    handleDragLeave,
    handleDrop,
    handleImageSelect,
    handleElectronFileSelect,
    handleUnifiedFileInputChange,
  } = useChatInputAttachments({
    attachmentManager,
    fileInputRef,
    effectiveSupportsImages,
    shouldLockComposeUi,
    isExternalAgent,
  });

  const handleSend = async () => {
    if (shouldLockComposeUi) {
      return;
    }
    if (!isEditMode && isExternalAgent && !sessionIdle) {
      showToast(t('chat.input.externalAgentBusy'), 'warning');
      return;
    }
    if (hasValidInput && !isProcessing && !isSubmittingEdit) {
      const messageToSend = attachmentManager.createMessage(textareaManager.get(), isEditMode
        ? {
            id: initialMessage?.id,
            timestamp: initialMessage?.timestamp,
          }
        : undefined);

      normalizeComposerMentions(messageToSend);

      const message = textareaManager.get().trim();
      if (!isEditMode && message) {
        profileDataManager.addPromptToHistory(message);
      }

      if (isEditMode) {
        if (!sessionIdle) {
          return;
        }
        if (!onSubmitEditedMessage) {
          return;
        }

        setIsAwaitingEditConfirmation(true);
        try {
          const confirmed = await requestInlineEditConfirmation(editConfirmDescription);
          if (!confirmed) {
            return;
          }

          setIsSubmittingEdit(true);
          try {
            await onSubmitEditedMessage(messageToSend);
          } catch (error) {
            logger.error('[ChatInput] Failed to submit inline edit:', error);
          } finally {
            setIsSubmittingEdit(false);
          }
        } finally {
          setIsAwaitingEditConfirmation(false);
        }
      } else {
        await submitComposeMessage(messageToSend);
      }
    }
  };

  const editConfirmDescription = warningMessage
    ? t('chat.input.regenerateWarningWithExternalActions')
    : t('chat.input.regenerateWarning');

  const requestInlineEditConfirmation = useCallback((description: string): Promise<boolean> => {
    return new Promise((resolve) => {
      const requestId = `inline-edit-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      const handleResult = (event: Event) => {
        const customEvent = event as CustomEvent<{ requestId?: string; confirmed?: boolean }>;
        if (customEvent.detail?.requestId !== requestId) {
          return;
        }

        window.removeEventListener('chatInput:confirmInlineEditResult', handleResult as EventListener);
        resolve(customEvent.detail?.confirmed === true);
      };

      window.addEventListener('chatInput:confirmInlineEditResult', handleResult as EventListener);
      window.dispatchEvent(new CustomEvent('chatInput:confirmInlineEditRequest', {
        detail: {
          requestId,
          title: t('chat.input.regenerateResponseTitle'),
          description,
        },
      }));
    });
  }, [t]);

  const handleVoiceTranscript = useCallback((transcript: string, isFinal: boolean) => {
    if (!isFinal || !transcript.trim()) {
      return;
    }
    const currentMessage = textareaManager.get();
    const nextMessage = currentMessage ? `${currentMessage} ${transcript}` : transcript;
    textareaManager.set(nextMessage);
    if (!editingQueuedMessageId) {
      saveComposeDraft(nextMessage);
      profileDataManager.setCurrentEditingPrompt(nextMessage);
    }
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(
          textareaRef.current.value.length,
          textareaRef.current.value.length
        );
      }
    }, 0);
  }, [editingQueuedMessageId, saveComposeDraft, textareaManager]);

  return (
    <div
      className={`chat-input-container ${isDragOver ? 'drag-over' : ''} ${isEditMode ? 'inline-edit-mode' : ''}`}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Error bar - embedded directly above the input area */}
      {!isEditMode && errorMessage && chatSessionId && (
        <ErrorBar errorMessage={errorMessage} chatSessionId={chatSessionId} />
      )}

      {!isEditMode && (
        <QueuedMessageList chatSessionId={chatSessionId} items={queuedMessages} />
      )}

      {pendingQueueStartMessage && (
        <QueuedMessageStartDialog
          onCancel={cancelPendingQueueStart}
          onKeepQueue={() => submitPendingQueueStartMessage(false)}
          onClearQueue={() => submitPendingQueueStartMessage(true)}
        />
      )}

      {shouldLockComposeUi && (
        <div
          style={{
            margin: '0 4px 10px',
            padding: '10px 12px',
            borderRadius: '12px',
            border: '1px solid rgb(var(--color-accent-rgb) / 0.28)',
            background: 'rgb(var(--color-accent-rgb) / 0.08)',
            color: 'rgba(30, 41, 59, 0.92)',
            fontSize: '12px',
            lineHeight: 1.4,
          }}
        >
          {t('chat.input.inlineEditLocked')}
        </div>
      )}

      <ChatInputControls
        attachmentsStateAtom={attachmentsStateAtom}
        textareaStateAtom={textareaStateAtom}
        fileInputRef={fileInputRef}
        textareaRef={textareaRef}
        handleImageSelect={handleImageSelect}
        handleSend={handleSend}
        handleElectronFileSelect={handleElectronFileSelect}
        handleUnifiedFileInputChange={handleUnifiedFileInputChange}
        onCancelChat={onCancelChat}
        onCancelEdit={onCancelEdit}
        onDraftChange={handleDraftChange}
        onVoiceTranscript={handleVoiceTranscript}
        attachMenuActions={attachMenuActions}
        editAgentMenuActions={editAgentMenuActions}
        enableContextMenu={enableContextMenu}
        chatInputShortcutHint={chatInputShortcutHint}
        currentChatId={currentChatId}
        effectiveSupportsImages={effectiveSupportsImages}
        shouldLockComposeUi={shouldLockComposeUi}
        isExternalAgent={isExternalAgent}
        isEditMode={isEditMode}
        isProcessing={isProcessing}
        isSubmittingEdit={isSubmittingEdit}
        isAwaitingEditConfirmation={isAwaitingEditConfirmation}
        enableVoiceInput={enableVoiceInput}
        voiceInputUserEnabled={voiceInputUserEnabled}
        sessionIdle={sessionIdle}
        editingQueuedMessageId={editingQueuedMessageId}
        hasValidInput={hasValidInput}
        setSupportsImages={setSupportsImages}
        updatePromptHistoryDraft={!isEditMode && !editingQueuedMessageId}
      />
    </div>
  );
};

export default ChatInput;