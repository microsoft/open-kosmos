import React, { useState, useRef, useEffect, useCallback } from 'react';
import { screenshotApi } from '../../ipc/screenshot-main';
import { profileDataManager } from '../../lib/userData/profileDataManager';
import { agentChatSessionCacheManager, ChatStatus, CurrentSessionError, CurrentSessionIdle } from '../../lib/chat/agentChatSessionCacheManager';
import { Message, MessageHelper, validateImageFile, UserMessage } from '@shared/types/chatTypes';
import { FileProcessor, } from '../../lib/utilities/contentUtils';
import { smartCompressImageVSCodeOfficial, shouldCompressImage } from '../../lib/utilities/imageCompression';
import ErrorBar from './ErrorBar';
import { useFeatureFlag } from '../../lib/featureFlags';
import { VoiceInputButton } from './VoiceInputButton';
import { useVoiceInputEnabled } from '../../lib/userData';
import { getChatInputShortcutHint } from '../../lib/chat/chatInputKeyboard';
import '../../styles/ChatInput.css';
import { createLogger } from '../../lib/utilities/logger';
import { createAttachmentsAtom, AttachmentList, AttachmentsStatus } from './chat-input/Attachments';
import { TextArea, createTextareaAtom } from './chat-input/Textarea';
import { ModelSelector } from './chat-input/ModelSelector';
import { ReasoningEffortSelector } from './chat-input/ReasoningEffortSelector';
import { attachment_icon_1, attachment_icon_2, cancel_icon, send_icon, send_icon_disabled, send_icon_spin } from './chat-input/Icons';
import { atom } from '@/atom';
import { useToast } from '../ui/ToastProvider';
import { agentChatIpc } from '@renderer/lib/chat/agentChatIpc';
import { EditAgentMenuAtom } from '../menu/EditAgentMenuDropdown';
import { AttachMenuAtom } from '../menu/AttachMenuDropdown';

const logger = createLogger('[ChatInput]');

interface ChatInputProps {
  onSendMessage: (message: UserMessage) => void;
  enableContextMenu?: boolean;
  // ErrorBar-related props
  chatSessionId?: string | null;
  // Read-only mode for remote sessions
  isReadOnly?: boolean;
  // Lock interactions while keeping the compose UI visible (used during inline edit mode)
  isInputLocked?: boolean;
  // Inline edit mode for a selected user message
  mode?: 'compose' | 'edit-inline';
  initialMessage?: Message | null;
  onSubmitEditedMessage?: (message: UserMessage) => Promise<void> | void;
  onCancelEdit?: () => void;
  warningMessage?: string | null;
}

const ChatInput: React.FC<ChatInputProps> = ({
  onSendMessage,
  enableContextMenu,
  // ErrorBar-related props
  chatSessionId,
  isReadOnly,
  isInputLocked = false,
  mode = 'compose',
  initialMessage = null,
  onSubmitEditedMessage,
  onCancelEdit,
  warningMessage,
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
  const [isDragOver, setIsDragOver] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false);
  const [isAwaitingEditConfirmation, setIsAwaitingEditConfirmation] = useState(false);
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

  async function onCancelChat() {
    try {
      logger.debug('[ChatInput] 🛑 Cancelling chat...');

      if (!currentChatId) {
        logger.warn('[ChatInput] No current chat ID to cancel');
        showToast('No active chat to cancel', 'warning');
        return;
      }

      await agentChatIpc.cancelChat(currentChatId);

      logger.debug('[ChatInput] ✅ Chat cancelled successfully');
    } catch (error) {
      logger.error('[ChatInput] ❌ Error cancelling chat:', error);
    }
  }

  // External agents only support text — disable attachments
  const isExternalAgent = React.useMemo(() => {
    if (!currentChatId) return false;
    const agent = profileDataManager.getCurrentAgent();
    return agent?.source === 'EXTERNAL';
  }, [currentChatId]);
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
    return () => {
      attachmentManager.clear();
      textareaManager.set('');
    };
  }, [attachmentManager, textareaManager]);


  // Listen for attach menu CustomEvent actions dispatched from AppLayout
  useEffect(() => {
    const handleSelectFiles = () => {
      handleElectronFileSelect();
    };
    const handleScreenshot = async () => {
      if (isProcessing) return;
      setIsProcessing(true);
      try {
        const result = await screenshotApi.capture();
        if (result && result.type === 'success') {
          const uint8Array = new Uint8Array(result.data);
          const blob = new Blob([uint8Array], { type: 'image/png' });
          const file = new File([blob], `screenshot-${Date.now()}.png`, { type: 'image/png' });
          await handleImageSelect(file);
        }
      } finally {
        setIsProcessing(false);
      }
    };

    window.addEventListener('chatInput:selectFiles', handleSelectFiles);
    window.addEventListener('chatInput:screenshot', handleScreenshot);
    return () => {
      window.removeEventListener('chatInput:selectFiles', handleSelectFiles);
      window.removeEventListener('chatInput:screenshot', handleScreenshot);
    };
  }, [isProcessing]);

  // Image handling with smart compression
  const handleImageSelect = async (file: File) => {

    // Validate image format
    if (!validateImageFile(file)) {
      alert(
        'Unsupported image format. Please select a PNG, JPEG, GIF, WEBP, or BMP image.',
      );
      return;
    }

    setIsProcessing(true);

    try {
      let processedFile = file;

      // Check whether compression is needed
      if (shouldCompressImage(file)) {

        const compressionResult = await smartCompressImageVSCodeOfficial(file);
        processedFile = compressionResult.compressedFile;
      }

      // Add to the attachment manager
      await attachmentManager.addImage(processedFile);

    } catch (error) {
      if ((error as Error)?.message?.startsWith('DUPLICATE:')) {
        alert(`This file is already attached: ${file.name}`);
      } else {
        alert('An error occurred while processing the image. Please try again.');
      }
    } finally {
      setIsProcessing(false);
    }
  };

  // File handling
  const handleFileSelect = async (file: File) => {
    logger.debug(`[ChatInput] handleFileSelect called:`, {
      name: file.name,
      type: file.type,
      size: file.size,
      fullPath: (file as any).fullPath,
      isOffice: FileProcessor.isOfficeFile(file),
      isText: FileProcessor.isTextFile(file),
    });

    setIsProcessing(true);

    try {
      if (FileProcessor.isOfficeFile(file)) {
        logger.debug(`[ChatInput] Processing as Office file: ${file.name}`);
        await attachmentManager.addOffice(file);
      } else if (FileProcessor.isTextFile(file)) {
        logger.debug(`[ChatInput] Processing as Text file: ${file.name}`);
        await attachmentManager.addFile(file);
      } else {
        logger.debug(`[ChatInput] Processing as Others file: ${file.name}`);
        await attachmentManager.addOthers(file);
      }
      logger.debug(`[ChatInput] ✅ File processed successfully: ${file.name}`);
    } catch (error) {
      if ((error as Error)?.message?.startsWith('DUPLICATE:')) {
        alert(`This file is already attached: ${file.name}`);
      } else {
        logger.error(`[ChatInput] ❌ handleFileSelect error for ${file.name}:`, error);
        logger.error(`[ChatInput] Error details:`, {
          message: (error as Error)?.message,
          stack: (error as Error)?.stack,
          name: (error as Error)?.name,
        });
        alert('An error occurred while processing the file. Please try again.');
      }
    } finally {
      setIsProcessing(false);
    }
  };

  // Drag-and-drop event handling
  const handleDragOver = (e: React.DragEvent) => {
    if (shouldLockComposeUi || isExternalAgent) {
      return;
    }
    e.preventDefault();
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragOver(true);
    }
  };

  const handleDragEnter = (e: React.DragEvent) => {
    if (shouldLockComposeUi || isExternalAgent) {
      return;
    }
    e.preventDefault();
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragOver(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (shouldLockComposeUi) {
      return;
    }
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;

    if (x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) {
      setIsDragOver(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    if (shouldLockComposeUi || isExternalAgent) {
      e.preventDefault();
      setIsDragOver(false);
      return;
    }
    e.preventDefault();
    setIsDragOver(false);

    const files = Array.from(e.dataTransfer.files);

    // FIX: Use Electron webUtils.getPathForFile() to obtain the full path for dragged files.
    // This is the official solution for the missing path property under contextIsolation: true.
    for (const file of files) {
      let resolvedPath: string | undefined;

      // Prefer the Electron API to obtain the path
      if (window.electronAPI?.fs?.getPathForFile) {
        try {
          resolvedPath = window.electronAPI.fs.getPathForFile(file);
          logger.debug(`[ChatInput] 🔥 Got path from webUtils.getPathForFile: ${resolvedPath}`);
        } catch (err) {
          logger.warn(`[ChatInput] ⚠️ webUtils.getPathForFile failed:`, err);
        }
      }

      // Fallback: check the path property on the File object
      if (!resolvedPath) {
        const filePath = (file as any).path;
        if (filePath) {
          resolvedPath = filePath;
          logger.debug(`[ChatInput] 📁 Using file.path: ${resolvedPath}`);
        }
      }

      // Attach the resolved path to the File object's fullPath property
      if (resolvedPath) {
        (file as any).fullPath = resolvedPath;
        logger.debug(`[ChatInput] ✅ Attached fullPath to file: ${resolvedPath}`);
      } else {
        logger.debug(`[ChatInput] ⚠️ No path available for file: ${file.name}`);
      }

      // Debug log
      logger.debug(`[ChatInput] 🔍 Dropped file: ${file.name}`, {
        fullPath: (file as any).fullPath,
        type: file.type,
        size: file.size
      });
    }

    const imageFiles = files.filter((file) => FileProcessor.isImageFile(file));
    const textFiles = files.filter((file) => FileProcessor.isTextFile(file));
    const officeFiles = files.filter((file) => FileProcessor.isOfficeFile(file));
    const otherFiles = files.filter((file) => FileProcessor.isOthersFile(file));

    // Process image files (only when the model supports images)
    if (imageFiles.length > 0 && effectiveSupportsImages) {

      for (const file of imageFiles) {
        if (validateImageFile(file)) {
          await handleImageSelect(file);
        } else {
          alert(
            `Unsupported image format: ${file.type}. Please drop a PNG, JPEG, GIF, WEBP, or BMP image.`,
          );
        }
      }
    } else if (imageFiles.length > 0 && !effectiveSupportsImages) {
      alert('The current model does not support images. Image files were ignored.');
    }

    // Process Office files (PDF, DOCX, PPTX, etc.)
    if (officeFiles.length > 0) {

      for (const file of officeFiles) {
        await handleFileSelect(file);
      }
    }

    // Process text files
    if (textFiles.length > 0) {

      for (const file of textFiles) {
        await handleFileSelect(file);
      }
    }

    // Process other file types
    if (otherFiles.length > 0) {

      for (const file of otherFiles) {
        await handleFileSelect(file);
      }
    }
  };

  // FIX: Use the Electron API to select files so that full paths are available
  const handleElectronFileSelect = async () => {
    try {
      if (!window.electronAPI?.fs?.selectFiles) {
        logger.error('Electron file selection API not available, falling back to browser selection');
        // Fall back to browser file selection
        fileInputRef.current?.click();
        return;
      }

      const result = await window.electronAPI.fs.selectFiles({
        title: 'Select Files to Attach',
        allowMultiple: true
      });

      if (result.success && result.filePaths && result.filePaths.length > 0) {
        setIsProcessing(true);

        try {
          for (const filePath of result.filePaths) {
            // Read file information from the file path
            const fileInfo = await window.electronAPI.fs.stat(filePath);
            const fileName = filePath.split('/').pop() || filePath.split('\\').pop() || 'unknown';
            const fileType = getFileTypeFromPath(filePath);
            const isImage = fileType.startsWith('image/');

            if (!fileInfo.success || !fileInfo.stats) {
              logger.error('Failed to stat file:', filePath);
              alert(`Failed to read file: ${filePath}`);
              continue;
            }

            if (isImage) {
              // Image file: read binary data as base64
              const fileContent = await window.electronAPI.fs.readFile(filePath, 'base64');

              if (!fileContent.success || !fileContent.content) {
                logger.error('Failed to read image file:', filePath);
                alert(`Failed to read file: ${filePath}`);
                continue;
              }

              const binaryString = atob(fileContent.content);
              const bytes = new Uint8Array(binaryString.length);
              for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
              }
              const blob = new Blob([bytes], { type: fileType });

              const file = new File([blob], fileName, {
                type: fileType,
                lastModified: fileInfo.stats.mtime
              });
              (file as any).fullPath = filePath;

              logger.debug(`[ChatInput] 🔥 Image file selected with full path: ${filePath}`);

              if (effectiveSupportsImages) {
                await handleImageSelect(file);
              } else {
                alert(`The current model does not support images. Ignored image file: ${file.name}`);
              }
            } else {
              // Non-image file: only metadata (path, name, size) is needed; do not read content
              const file = new File([], fileName, {
                type: fileType,
                lastModified: fileInfo.stats.mtime
              });
              // Overwrite the empty Blob's size with the real file size from stat
              Object.defineProperty(file, 'size', { value: fileInfo.stats.size });
              (file as any).fullPath = filePath;

              logger.debug(`[ChatInput] 📁 Non-image file selected with full path: ${filePath}, size: ${fileInfo.stats.size}`);

              await handleFileSelect(file);
            }
          }
        } catch (error) {
          logger.error('Error processing selected files:', error);
          alert('An error occurred while processing the selected files.');
        } finally {
          setIsProcessing(false);
        }
      }
    } catch (error) {
      logger.error('Error selecting files:', error);
      alert('File selection failed. Please try again.');
    }
  };

  // FIX: Helper function to get MIME type from file extension
  const getFileTypeFromPath = (filePath: string): string => {
    const extension = filePath.toLowerCase().split('.').pop() || '';
    const mimeMap: Record<string, string> = {
      'png': 'image/png',
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'gif': 'image/gif',
      'webp': 'image/webp',
      'bmp': 'image/bmp',
      'txt': 'text/plain',
      'md': 'text/markdown',
      'js': 'text/javascript',
      'ts': 'text/typescript',
      'json': 'application/json',
      'pdf': 'application/pdf',
      'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      // Add more types as needed...
    };
    return mimeMap[extension] || 'application/octet-stream';
  };

  // Keep the original browser file selection as a fallback
  const handleUnifiedFileInputChange = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const files = e.target.files;
    if (files) {
      for (const file of Array.from(files)) {
        // FIX: Use Electron webUtils.getPathForFile() to obtain the full file path
        let resolvedPath: string | undefined;

        // Prefer the Electron API to obtain the path
        if (window.electronAPI?.fs?.getPathForFile) {
          try {
            resolvedPath = window.electronAPI.fs.getPathForFile(file);
            logger.debug(`[ChatInput] 🔥 Browser input - Got path from webUtils.getPathForFile: ${resolvedPath}`);
          } catch (err) {
            logger.warn(`[ChatInput] ⚠️ Browser input - webUtils.getPathForFile failed:`, err);
          }
        }

        // Fallback: check the path property on the File object
        if (!resolvedPath) {
          const filePath = (file as any).path;
          if (filePath) {
            resolvedPath = filePath;
            logger.debug(`[ChatInput] 📁 Browser input - Using file.path: ${resolvedPath}`);
          }
        }

        // Attach the resolved path to the File object's fullPath property
        if (resolvedPath) {
          (file as any).fullPath = resolvedPath;
          logger.debug(`[ChatInput] ✅ Browser input - Attached fullPath to file: ${resolvedPath}`);
        } else {
          logger.debug(`[ChatInput] ⚠️ Browser input - No path available for file: ${file.name}`);
        }

        // Debug log
        logger.debug(`[ChatInput] 🔍 Browser selected file: ${file.name}`, {
          fullPath: (file as any).fullPath,
          type: file.type,
          size: file.size
        });

        // Intelligently determine how to handle the file based on its type
        if (FileProcessor.isImageFile(file)) {
          // Check whether the current model supports images
          if (effectiveSupportsImages) {
            await handleImageSelect(file);
          } else {
            alert(`The current model does not support images. Ignored image file: ${file.name}`);
          }
        } else {
          // Handle text files and other file types
          await handleFileSelect(file);
        }
      }
    }
    // Reset the input to allow selecting the same file again
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSend = async () => {
    if (shouldLockComposeUi) {
      return;
    }
    // Only allow sending when idle and content is valid
    if (sessionIdle && hasValidInput && !isProcessing && !isSubmittingEdit) {
      const messageToSend = attachmentManager.createMessage(textareaManager.get(), isEditMode
        ? {
            id: initialMessage?.id,
            timestamp: initialMessage?.timestamp,
          }
        : undefined);

      // Convert [@knowledge-base:...], [@chat-session:...], [@workspace:...] and [#skill:...]
      // to markdown format (strip the surrounding square brackets).
      // Iterate over message content and transform mention text into inline code.
      messageToSend.content = messageToSend.content.map(part => {
        if (part.type === 'text') {
          let processedText = part.text;

          // Convert [@knowledge-base:...] to `@knowledge-base:...` (strip brackets)
          processedText = processedText.replace(
            /\[@knowledge-base:([^\]]+)\]/g,
            '`@knowledge-base:$1`'
          );

          // Convert [@chat-session:...] to `@chat-session:...` (strip brackets)
          processedText = processedText.replace(
            /\[@chat-session:([^\]]+)\]/g,
            '`@chat-session:$1`'
          );

          // Convert [@workspace:...] to `@workspace:...` (strip brackets, backward-compatible)
          processedText = processedText.replace(
            /\[@workspace:([^\]]+)\]/g,
            '`@workspace:$1`'
          );

          // Convert [#skill:...] to `#skill:...` (strip brackets)
          processedText = processedText.replace(
            /\[#skill:([^\]]+)\]/g,
            '`#skill:$1`'
          );

          return {
            ...part,
            text: processedText
          };
        }
        return part;
      });

      // Add to prompt history queue only for normal send mode
      const message = textareaManager.get().trim();
      if (!isEditMode && message) {
        profileDataManager.addPromptToHistory(message);
      }

      if (isEditMode) {
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
        // Send the message in unified format
        onSendMessage(messageToSend);

        textareaManager.set('');
        attachmentManager.clear();

        if (textareaRef.current) {
          textareaRef.current.focus();
        }
      }
    }
  };

  const editConfirmDescription = warningMessage
    ? 'This will replace the response below and regenerate from your edited message. External actions already run will not be undone.'
    : 'This will replace the response below and regenerate from your edited message.';

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
          title: 'Regenerate response?',
          description,
        },
      }));
    });
  }, []);

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

      {shouldLockComposeUi && (
        <div
          style={{
            margin: '0 4px 10px',
            padding: '10px 12px',
            borderRadius: '12px',
            border: '1px solid rgba(14, 165, 233, 0.28)',
            background: 'rgba(14, 165, 233, 0.08)',
            color: 'rgba(30, 41, 59, 0.92)',
            fontSize: '12px',
            lineHeight: 1.4,
          }}
        >
          Inline message editing is active above. Save or cancel that edit to continue composing here.
        </div>
      )}

      {/* Main input area - integrated design */}
      <div
        className="input-area"
        style={shouldLockComposeUi ? { opacity: 0.7, pointerEvents: 'none' } : undefined}
      >
        {/* Unified attachment display area */}
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
        />

        {/* Button area */}
        <div className="button-area">
          {/* Unified attach button (click to open the menu, managed by AppLayout) */}
          {!isExternalAgent && (
          <button
            className="attachment-button file-attachment-button"
            onClick={(e) => {
              if (isEditMode) {
                handleElectronFileSelect();
                return;
              }
              attachMenuActions.toggle(e.currentTarget);
            }}
            disabled={isProcessing || isSubmittingEdit || shouldLockComposeUi}
            title="Attach"
          >
            {attachment_icon_1}
          </button>
          )}

          {/* Edit Agent button */}
          {!isEditMode && (
          <button
            className="attachment-button edit-agent-button"
            onClick={(e) => {
                if (shouldLockComposeUi) {
                  return;
                }
              editAgentMenuActions.toggle(e.currentTarget);
            }}
              disabled={shouldLockComposeUi}
            title="Edit Agent (MCP Tools, System Prompt & Context Enhancement)"
          >
            {attachment_icon_2}
          </button>
          )}

          {/* Unified hidden file input - supports both images and text files */}
          <input
            ref={fileInputRef}
            type="file"
            accept="*"
            onChange={handleUnifiedFileInputChange}
            style={{ display: 'none' }}
            multiple
          />

          {/* Voice Input Button - positioned to the left of model selector */}
          {!isEditMode && enableVoiceInput && voiceInputUserEnabled && (
            <VoiceInputButton
              onTranscript={(transcript, isFinal) => {
                if (isFinal && transcript.trim()) {
                  // Append the final transcript to the current message
                  textareaManager.set(prev => {
                    return prev ? `${prev} ${transcript}` : transcript;
                  });
                  // Focus the textarea after voice input
                  setTimeout(() => {
                    if (textareaRef.current) {
                      textareaRef.current.focus();
                      // Move cursor to end
                      textareaRef.current.setSelectionRange(
                        textareaRef.current.value.length,
                        textareaRef.current.value.length
                      );
                    }
                  }, 0);
                }
              }}
              disabled={isProcessing || !sessionIdle || shouldLockComposeUi}
            />
          )}

          {/* Send Button - on the right side */}
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

            {/* Send/Cancel button - switches in place based on chat status */}
          {sessionIdle ? (
            /* Send button - shown only when chat status is explicitly idle */
            isEditMode ? (
            <>
              <button
                onClick={onCancelEdit}
                className="inline-edit-action-button inline-edit-action-button-secondary"
                type="button"
                disabled={isSubmittingEdit || isAwaitingEditConfirmation}
                title="Cancel"
                aria-label="Cancel"
              >
                Cancel
              </button>
              <button
                onClick={handleSend}
                disabled={!hasValidInput || isProcessing || isSubmittingEdit || isAwaitingEditConfirmation || shouldLockComposeUi}
                className="inline-edit-action-button inline-edit-action-button-primary"
                title="Send"
                aria-label="Send"
                type="button"
              >
                {isSubmittingEdit ? 'Sending...' : isAwaitingEditConfirmation ? 'Waiting...' : 'Send'}
              </button>
            </>
            ) : (
            <button
              onClick={handleSend}
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
                title="Cancel"
                aria-label="Cancel"
              >
                Cancel
              </button>
              <button
                onClick={handleSend}
                disabled
                className="inline-edit-action-button inline-edit-action-button-primary"
                title="Waiting for chat status"
                aria-label="Send"
                type="button"
              >
                {isSubmittingEdit ? 'Sending...' : isAwaitingEditConfirmation ? 'Waiting...' : 'Send'}
              </button>
            </>
          ) : (!sessionIdle) ? (
            /* Cancel button - shown when chat status is explicitly non-idle, replaces the Send button */
            <button
              onClick={onCancelChat}
              disabled={shouldLockComposeUi}
              className="send-button cancel-button" // send-button as base style, cancel-button as modifier
              title="Cancel Chat"
            >
              {cancel_icon}
            </button>
          ) : (
            <button disabled className="send-button" title="Waiting for chat status" type="button">
              {send_icon_disabled}
            </button>
          )}
          </div>
        </div>
      </div>

      {/* Content statistics display (development mode only) */}
      {process.env.NODE_ENV === 'development' && <AttachmentsStatus attachmentsStateAtom={attachmentsStateAtom} />}
    </div>
  );
};

export default ChatInput;