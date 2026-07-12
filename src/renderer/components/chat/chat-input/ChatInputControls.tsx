import React, { type ChangeEvent, type RefObject } from 'react';
import { VoiceInputButton } from '../VoiceInputButton';
import { AttachmentList, AttachmentsStatus, type AttachmentsStateAtom } from './Attachments';
import { TextArea, type TextareaStateAtom } from './Textarea';
import { ModelSelector } from './ModelSelector';
import { ReasoningEffortSelector } from './ReasoningEffortSelector';
import {
  attachment_icon_1,
  attachment_icon_2,
  cancel_icon,
  send_icon,
  send_icon_disabled,
  send_icon_spin,
} from './Icons';
import { useI18n } from '../../../lib/i18n/useI18n';

interface ToggleMenuActions {
  toggle: (target: HTMLElement) => void;
}

interface ChatInputControlsProps {
  attachmentsStateAtom: AttachmentsStateAtom;
  textareaStateAtom: TextareaStateAtom;
  fileInputRef: RefObject<HTMLInputElement>;
  textareaRef: RefObject<HTMLTextAreaElement>;
  handleImageSelect: (file: File) => Promise<void>;
  handleSend: () => Promise<void>;
  handleElectronFileSelect: () => Promise<void>;
  handleUnifiedFileInputChange: (e: ChangeEvent<HTMLInputElement>) => Promise<void>;
  onCancelChat: () => Promise<void>;
  onCancelEdit?: () => void;
  onDraftChange: (text: string) => void;
  onVoiceTranscript: (transcript: string, isFinal: boolean) => void;
  attachMenuActions: ToggleMenuActions;
  editAgentMenuActions: ToggleMenuActions;
  enableContextMenu?: boolean;
  chatInputShortcutHint: string;
  currentChatId: string | null;
  effectiveSupportsImages: boolean;
  shouldLockComposeUi: boolean;
  isExternalAgent: boolean;
  isEditMode: boolean;
  isProcessing: boolean;
  isSubmittingEdit: boolean;
  isAwaitingEditConfirmation: boolean;
  enableVoiceInput: boolean;
  voiceInputUserEnabled: boolean;
  sessionIdle: boolean;
  editingQueuedMessageId: string | null;
  hasValidInput: boolean;
  setSupportsImages: (supportsImages: boolean) => void;
  updatePromptHistoryDraft: boolean;
}

export function ChatInputControls(props: ChatInputControlsProps) {
  const { t } = useI18n();
  const {
    attachmentsStateAtom,
    textareaStateAtom,
    fileInputRef,
    textareaRef,
    handleImageSelect,
    handleSend,
    handleElectronFileSelect,
    handleUnifiedFileInputChange,
    onCancelChat,
    onCancelEdit,
    onDraftChange,
    onVoiceTranscript,
    attachMenuActions,
    editAgentMenuActions,
    enableContextMenu,
    chatInputShortcutHint,
    currentChatId,
    effectiveSupportsImages,
    shouldLockComposeUi,
    isExternalAgent,
    isEditMode,
    isProcessing,
    isSubmittingEdit,
    isAwaitingEditConfirmation,
    enableVoiceInput,
    voiceInputUserEnabled,
    sessionIdle,
    editingQueuedMessageId,
    hasValidInput,
    setSupportsImages,
    updatePromptHistoryDraft,
  } = props;

  return (
    <>
      <div
        className="input-area"
        style={shouldLockComposeUi ? { opacity: 0.7, pointerEvents: 'none' } : undefined}
      >
        <AttachmentList attachmentsStateAtom={attachmentsStateAtom} />
        <TextArea
          handleImageSelect={handleImageSelect}
          handleSend={handleSend}
          textareaRef={textareaRef}
          readOnly={shouldLockComposeUi}
          title={chatInputShortcutHint}
          supportsImages={effectiveSupportsImages}
          enableContextMenu={enableContextMenu}
          textareaStateAtom={textareaStateAtom}
          onDraftChange={onDraftChange}
          updatePromptHistoryDraft={updatePromptHistoryDraft}
        />

        <div className="button-area">
          {!isExternalAgent && (
            <button
              className="attachment-button file-attachment-button"
              onClick={(e) => {
                if (isEditMode) {
                  void handleElectronFileSelect();
                  return;
                }
                attachMenuActions.toggle(e.currentTarget);
              }}
              disabled={isProcessing || isSubmittingEdit || shouldLockComposeUi}
              title={t('chat.input.attach')}
            >
              {attachment_icon_1}
            </button>
          )}

          {!isEditMode && (
            <button
              className="attachment-button edit-agent-button"
              onClick={(e) => {
                /* v8 ignore next 3 -- disabled buttons cannot fire from user interaction; this protects programmatic events. */
                if (shouldLockComposeUi) {
                  return;
                }
                editAgentMenuActions.toggle(e.currentTarget);
              }}
              disabled={shouldLockComposeUi}
              title={t('chat.input.editAgent')}
            >
              {attachment_icon_2}
            </button>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="*"
            onChange={(event) => void handleUnifiedFileInputChange(event)}
            style={{ display: 'none' }}
            multiple
          />

          {!isEditMode && enableVoiceInput && voiceInputUserEnabled && (
            <VoiceInputButton
              onTranscript={onVoiceTranscript}
              disabled={isProcessing || !sessionIdle || shouldLockComposeUi}
            />
          )}

          <div className="right-buttons-group">
            {!isEditMode && (
              <ModelSelector
                currentChatId={currentChatId}
                shouldLockComposeUi={shouldLockComposeUi}
                setSupportsImages={setSupportsImages}
              />
            )}

            {!isEditMode && (
              <ReasoningEffortSelector
                currentChatId={currentChatId}
                shouldLockComposeUi={shouldLockComposeUi}
              />
            )}

            {sessionIdle ? (
              isEditMode ? (
                <>
                  <button
                    onClick={onCancelEdit}
                    className="inline-edit-action-button inline-edit-action-button-secondary"
                    type="button"
                    disabled={isSubmittingEdit || isAwaitingEditConfirmation}
                    title={t('chat.input.cancel')}
                    aria-label={t('chat.input.cancel')}
                  >
                    {t('chat.input.cancel')}
                  </button>
                  <button
                    onClick={() => void handleSend()}
                    disabled={!hasValidInput || isProcessing || isSubmittingEdit || isAwaitingEditConfirmation || shouldLockComposeUi}
                    className="inline-edit-action-button inline-edit-action-button-primary"
                    title={t('chat.input.send')}
                    aria-label={t('chat.input.send')}
                    type="button"
                  >
                    {isSubmittingEdit ? t('chat.input.sending') : isAwaitingEditConfirmation ? t('chat.input.waiting') : t('chat.input.send')}
                  </button>
                </>
              ) : editingQueuedMessageId ? (
                <button
                  onClick={() => void handleSend()}
                  disabled={!hasValidInput || isProcessing || shouldLockComposeUi}
                  className="send-button"
                  title={t('chat.input.updateQueuedMessage')}
                  aria-label={t('chat.input.updateQueuedMessage')}
                >
                  {isProcessing ? send_icon_spin : send_icon}
                </button>
              ) : (
                <button
                  onClick={() => void handleSend()}
                  disabled={!hasValidInput || isProcessing || shouldLockComposeUi}
                  className="send-button"
                  title={chatInputShortcutHint}
                >
                  {isProcessing ? send_icon_spin : send_icon}
                </button>
              )
            ) : isEditMode ? (
              <>
                <button
                  onClick={onCancelEdit}
                  className="inline-edit-action-button inline-edit-action-button-secondary"
                  type="button"
                  disabled={isSubmittingEdit || isAwaitingEditConfirmation}
                  title={t('chat.input.cancel')}
                  aria-label={t('chat.input.cancel')}
                >
                  {t('chat.input.cancel')}
                </button>
                <button
                  /* v8 ignore next -- this disabled button cannot fire from user interaction. */
                  onClick={() => void handleSend()}
                  disabled
                  className="inline-edit-action-button inline-edit-action-button-primary"
                  title={t('chat.input.waitingForChatStatus')}
                  aria-label={t('chat.input.send')}
                  type="button"
                >
                  {isSubmittingEdit ? t('chat.input.sending') : isAwaitingEditConfirmation ? t('chat.input.waiting') : t('chat.input.send')}
                </button>
              </>
            ) : !sessionIdle ? (
              <>
                {!isExternalAgent && (editingQueuedMessageId || hasValidInput) && (
                  <button
                    onClick={() => void handleSend()}
                    disabled={!hasValidInput || isProcessing || shouldLockComposeUi}
                    className="send-button"
                    title={editingQueuedMessageId ? t('chat.input.updateQueuedMessage') : t('chat.input.queueMessageAfterCurrentResponse')}
                    aria-label={editingQueuedMessageId ? t('chat.input.updateQueuedMessage') : t('chat.input.queueMessageAfterCurrentResponse')}
                  >
                    {isProcessing ? send_icon_spin : send_icon}
                  </button>
                )}
                {(isExternalAgent || (!editingQueuedMessageId && !hasValidInput)) && (
                  <button
                    onClick={() => void onCancelChat()}
                    disabled={shouldLockComposeUi}
                    className="send-button cancel-button"
                    title={t('chat.input.cancelCurrentResponse')}
                    aria-label={t('chat.input.cancelCurrentResponse')}
                  >
                    {cancel_icon}
                  </button>
                )}
              </>
            ) : (
              <button disabled className="send-button" title={t('chat.input.waitingForChatStatus')} type="button">
                {send_icon_disabled}
              </button>
            )}
          </div>
        </div>
      </div>

      {process.env.NODE_ENV === 'development' && (
        <AttachmentsStatus attachmentsStateAtom={attachmentsStateAtom} />
      )}
    </>
  );
}
