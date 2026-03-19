import React, { useState, useRef, useEffect, useCallback } from 'react';
import { screenshotApi } from '../../ipc/screenshot-main';
import { profileDataManager } from '../../lib/userData/profileDataManager';
import { useAgentConfig, useProfileData, useChats } from '../userData/userDataProvider';
import { getModelById, getModelCapabilities, getAllKosmosUsedModels } from '../../lib/models/ghcModels';
import { agentChatSessionCacheManager } from '../../lib/chat/agentChatSessionCacheManager';
import {
  UnifiedContentPart,
  TextContentPart,
  ImageContentPart,
  FileContentPart,
  OfficeContentPart,
  OthersContentPart,
  Message,
  MessageHelper,
  validateImageFile
} from '../../types/chatTypes';
import {
  ContentPartFactory,
  ContentConverter,
  ContentValidator,
  ContentAnalyzer,
  FileProcessor,
  formatFileSize,
} from '../../lib/utilities/contentUtils';
import FileTypeIcon from '../ui/FileTypeIcon';
import { smartCompressImageVSCodeOfficial, shouldCompressImage, VSCODE_IMAGE_LIMITS } from '../../lib/utilities/imageCompression';
import {
  getCurrentSearchQuery,
  insertMention,
  ContextOption,
  ContextMenuOptionType,
  ContextMenuTriggerType,
  MentionSourceType,
  getContextMenuTriggerType,
  getCurrentSkillSearchQuery,
  insertSkillMention,
} from '../../lib/chat/contextMentions';
import { ContextMenu } from './ContextMenu';
import { MentionHighlight } from './MentionHighlight';
import { quickSearchFiles } from '../../lib/workspace/workspaceSearchService';
import ApprovalBar, { ApprovalRequestItem } from './ApprovalBar';
import ErrorBar from './ErrorBar';
import { useFeatureFlag } from '../../lib/featureFlags';
import { VoiceInputButton } from './VoiceInputButton';
import { useVoiceInputEnabled } from '../../lib/userData';
import '../../styles/ChatInput.css';

interface ChatInputProps {
  onSendMessage: (message: Message) => void;
  chatStatus?: {
    chatId: string;
    chatStatus: 'idle' | 'sending_response' | 'compressing_context' | 'compressed_context' | 'received_response';
    agentName?: string;
  } | null; // Use the full chatStatus object
  onCancelChat?: () => void; // Callback to cancel the current conversation
  onContextMenuTrigger?: (query: string, inputRect: DOMRect, triggerType?: ContextMenuTriggerType) => void; // Added triggerType parameter
  onContextMenuClose?: () => void;
  contextMenuState?: {
    isOpen: boolean;
    options: ContextOption[];
    selectedIndex: number;
  };
  onContextMenuNavigate?: (direction: 'up' | 'down') => void;
  approvalRequests?: ApprovalRequestItem[];
  onApproveRequest?: (requestId: string) => void;
  onRejectRequest?: (requestId: string) => void;
  onTimeoutAutoReject?: (requestIds: string[]) => void;
  // ErrorBar-related props
  errorMessage?: string | null;
  chatSessionId?: string | null;
  onRetry?: (chatSessionId: string) => void;
  // Replay state - disables send while replay is in progress
  isReplaying?: boolean;
}

// Unified attachment manager
class UnifiedAttachmentManager {
  private content: UnifiedContentPart[] = [];
  private previewUrls: Map<string, string> = new Map();
  private onUpdate: () => void;

  constructor(onUpdate: () => void) {
    this.onUpdate = onUpdate;
  }

  // Check whether an identical attachment already exists (by fullPath or fileName+size)
  private isDuplicate(fileName: string, fileSize: number, fullPath?: string): boolean {
    return this.content.some(part => {
      if (part.type === 'text') return false;

      if (part.type === 'image') {
        const img = part as ImageContentPart;
        if (fullPath && img.image_url.url && (img as any)._fullPath === fullPath) return true;
        return img.metadata.fileName === fileName && img.metadata.fileSize === fileSize;
      }
      if (part.type === 'file') {
        const f = part as FileContentPart;
        if (fullPath && f.file.filePath === fullPath) return true;
        return f.file.fileName === fileName && f.metadata.fileSize === fileSize;
      }
      if (part.type === 'office') {
        const o = part as OfficeContentPart;
        if (fullPath && o.file.filePath === fullPath) return true;
        return o.file.fileName === fileName && o.metadata.fileSize === fileSize;
      }
      if (part.type === 'others') {
        const ot = part as OthersContentPart;
        if (fullPath && ot.file.filePath === fullPath) return true;
        return ot.file.fileName === fileName && ot.metadata.fileSize === fileSize;
      }
      return false;
    });
  }

  // Add text content
  setText(text: string) {
    // Remove existing text content
    this.content = this.content.filter(part => part.type !== 'text');
    
    // If there is new text, prepend it
    if (text.trim()) {
      this.content.unshift(ContentPartFactory.createText(text));
    }
    
    this.onUpdate();
  }

  // Add image content
  async addImage(file: File): Promise<void> {
    if (this.isDuplicate(file.name, file.size, (file as any).fullPath)) {
      console.log(`[AttachmentManager] Duplicate image skipped: ${file.name}`);
      throw new Error(`DUPLICATE: ${file.name}`);
    }
    try {
      const imageContent = await ContentConverter.fileToImageContent(file);
      
      // Save fullPath for later deduplication checks
      if ((file as any).fullPath) {
        (imageContent as any)._fullPath = (file as any).fullPath;
      }
      
      // Create preview URL
      const previewUrl = await FileProcessor.fileToDataURL(file);
      this.previewUrls.set(imageContent.metadata.fileName, previewUrl);
      
      this.content.push(imageContent);
      this.onUpdate();
    } catch (error) {
      throw error;
    }
  }

  // Add file content
  async addFile(file: File): Promise<void> {
    console.log(`[AttachmentManager] addFile called: ${file.name}, size=${file.size}, type=${file.type}`);
    if (this.isDuplicate(file.name, file.size, (file as any).fullPath)) {
      console.log(`[AttachmentManager] Duplicate file skipped: ${file.name}`);
      throw new Error(`DUPLICATE: ${file.name}`);
    }
    try {
      const fileContent = await ContentConverter.fileToFileContent(file);
      this.content.push(fileContent);
      console.log(`[AttachmentManager] ✅ addFile success: ${file.name}`);
      this.onUpdate();
    } catch (error) {
      console.error(`[AttachmentManager] ❌ addFile error:`, error);
      throw error;
    }
  }

  // Add other file-type content
  async addOthers(file: File): Promise<void> {
    console.log(`[AttachmentManager] addOthers called: ${file.name}, size=${file.size}, type=${file.type}`);
    if (this.isDuplicate(file.name, file.size, (file as any).fullPath)) {
      console.log(`[AttachmentManager] Duplicate others file skipped: ${file.name}`);
      throw new Error(`DUPLICATE: ${file.name}`);
    }
    try {
      const othersContent = await ContentConverter.fileToOthersContent(file);
      this.content.push(othersContent);
      console.log(`[AttachmentManager] ✅ addOthers success: ${file.name}`);
      this.onUpdate();
    } catch (error) {
      console.error(`[AttachmentManager] ❌ addOthers error:`, error);
      throw error;
    }
  }

  // Add Office document content
  async addOffice(file: File): Promise<void> {
    console.log(`[AttachmentManager] addOffice called: ${file.name}, size=${file.size}, type=${file.type}, fullPath=${(file as any).fullPath}`);
    if (this.isDuplicate(file.name, file.size, (file as any).fullPath)) {
      console.log(`[AttachmentManager] Duplicate office file skipped: ${file.name}`);
      throw new Error(`DUPLICATE: ${file.name}`);
    }
    try {
      const officeContent = await ContentConverter.fileToOfficeContent(file);
      this.content.push(officeContent);
      console.log(`[AttachmentManager] ✅ addOffice success: ${file.name}`);
      this.onUpdate();
    } catch (error) {
      console.error(`[AttachmentManager] ❌ addOffice error:`, error);
      throw error;
    }
  }

  // Remove content
  removeContent(index: number) {
    const part = this.content[index];
    if (part) {
      // Clean up preview URL
      if (part.type === 'image') {
        const fileName = (part as ImageContentPart).metadata.fileName;
        const previewUrl = this.previewUrls.get(fileName);
        if (previewUrl) {
          URL.revokeObjectURL(previewUrl);
          this.previewUrls.delete(fileName);
        }
      }
      
      this.content.splice(index, 1);
      this.onUpdate();
    }
  }

  // Get all content
  getContent(): UnifiedContentPart[] {
    return [...this.content];
  }

  // Get preview URL
  getPreviewUrl(fileName: string): string | undefined {
    return this.previewUrls.get(fileName);
  }

  // Get attachment statistics
  getStats() {
    return ContentAnalyzer.analyzeContent(this.content);
  }

  // Clear all content
  clear() {
    // Clean up all preview URLs
    this.previewUrls.forEach(url => URL.revokeObjectURL(url));
    this.previewUrls.clear();
    
    this.content = [];
    this.onUpdate();
  }

  // Check whether the content is valid
  isValid(): boolean {
    const hasText = this.content.some(part => part.type === 'text' && part.text.trim());
    const hasAttachments = this.content.some(part => part.type !== 'text');
    return hasText || hasAttachments;
  }

  // Create message
  createMessage(role: Message['role'] = 'user'): Message {
    return {
      id: `msg_${role}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      role,
      content: this.getContent(),
      timestamp: Date.now()
    };
  }
}

interface ChatInputPropsExtended extends ChatInputProps {
  onOpenMcpTools?: () => void;
  onEditAgentMenuToggle?: (buttonElement: HTMLElement) => void;
  onAttachMenuToggle?: (buttonElement: HTMLElement) => void;
}

const ChatInput: React.FC<ChatInputPropsExtended> = ({
  onSendMessage,
  chatStatus,
  onCancelChat,
  onOpenMcpTools,
  onEditAgentMenuToggle,
  onAttachMenuToggle,
  onContextMenuTrigger,
  onContextMenuClose,
  contextMenuState,
  onContextMenuNavigate,
  approvalRequests = [],
  onApproveRequest,
  onRejectRequest,
  onTimeoutAutoReject,
  // ErrorBar-related props
  errorMessage,
  chatSessionId,
  onRetry,
  isReplaying,
}) => {
  const [message, setMessage] = useState('');
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  // Voice Input is controlled by a feature flag and must be enabled in Settings
  const enableVoiceInput = useFeatureFlag('kosmosFeatureVoiceInput');
  const voiceInputUserEnabled = useVoiceInputEnabled();

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const modelDropdownRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);


  // State used to force a re-render
  const [forceUpdate, setForceUpdate] = useState(0);

  // Unified attachment manager instance
  const [attachmentManager] = useState(
    () =>
      new UnifiedAttachmentManager(() => {
        // Force re-render
        setForceUpdate((prev) => prev + 1);
      }),
  );

  // Used to prevent triggering edit monitoring when handling history
  const isNavigatingHistory = useRef(false);

  // Fully based on profileDataManager and currentChatId
  // Get currentChatId from agentChatSessionCacheManager
  const [currentChatId, setCurrentChatId] = useState<string | null>(
    agentChatSessionCacheManager.getCurrentChatId()
  );
  
  // Watch for currentChatId changes
  useEffect(() => {
    const unsubscribe = agentChatSessionCacheManager.subscribeToCurrentChatSessionId(() => {
      const newChatId = agentChatSessionCacheManager.getCurrentChatId();
      setCurrentChatId(newChatId);
    });
    return unsubscribe;
  }, []);

  // Get the current model from profileDataManager
  // Use currentChatId to look up the corresponding model id in config
  const [currentModel, setCurrentModel] = useState<string | null>(() => {
    return currentChatId ? profileDataManager.getSelectedModel(currentChatId) : null;
  });

  // Local pending state to immediately reflect UI selection
  const [pendingModel, setPendingModel] = useState<string | null>(null);

  // Use the pending model (or actual current model) to drive the UI
  const displayModel = pendingModel || currentModel;

  // Watch currentChatId changes and fetch the new model from profileDataManager
  useEffect(() => {
    if (currentChatId) {
      const newModel = profileDataManager.getSelectedModel(currentChatId);
      console.log('[ChatInput] currentChatId changed, updating model selector:', {
        currentChatId,
        newModel
      });
      setCurrentModel(newModel);
      // Clear pending state and show the new agent's model
      setPendingModel(null);
    } else {
      setCurrentModel(null);
      setPendingModel(null);
    }
  }, [currentChatId]);

  // Watch ProfileDataManager config changes and update the model
  useEffect(() => {
    const unsubscribe = profileDataManager.subscribe((cache) => {
      if (!currentChatId) return;
      
      // Get the current chat's model from config
      const updatedModel = profileDataManager.getSelectedModel(currentChatId);
      
      // Only update when the model actually changes
      if (updatedModel !== currentModel) {
        console.log('[ChatInput] ProfileDataManager notified model change:', {
          currentChatId,
          oldModel: currentModel,
          newModel: updatedModel
        });
        setCurrentModel(updatedModel);
        // Clear pending state and use the latest value from ProfileDataManager
        setPendingModel(null);
      }
    });
    
    return unsubscribe;
  }, [currentChatId, currentModel]);

  // When currentModel updates, clear the pending state if it matches
  useEffect(() => {
    if (currentModel && pendingModel && currentModel === pendingModel) {
      setPendingModel(null);
    }
  }, [currentModel, pendingModel]);

  // Get the updateModel function and isLoading state
  const { updateModel, isLoading } = useAgentConfig();

  // For backward compatibility, we'll need to get available models from ghcModels
  const [availableModels, setAvailableModels] = useState<any[]>([]);

  // Load available models - use Kosmos used models only
  useEffect(() => {
    const loadModels = async () => {
      try {
        const kosmosModels = getAllKosmosUsedModels();
        setAvailableModels(kosmosModels);
      } catch (error) {
        setAvailableModels([]);
      }
    };
    loadModels();
  }, []);

  // Watch currentModel changes for debugging state updates
  // useEffect(() => {
  // }, [currentModel]);

  // Sync text content to the attachment manager
  useEffect(() => {
    attachmentManager.setText(message);
  }, [message, attachmentManager]);

  // Listen for mention selection events from ChatView
  useEffect(() => {
    const handleMentionSelectEvent = (e: CustomEvent) => {
      const { option } = e.detail;
      handleMentionSelect(option);
    };

    window.addEventListener(
      'context:mentionSelect',
      handleMentionSelectEvent as EventListener,
    );
    return () => {
      window.removeEventListener(
        'context:mentionSelect',
        handleMentionSelectEvent as EventListener,
      );
    };
  }, [message]); // Depends on message because handleMentionSelect uses it

  // Listen for skill mention selection events from ChatView
  useEffect(() => {
    const handleSkillMentionSelectEvent = (e: CustomEvent) => {
      const { skillName } = e.detail;
      if (!textareaRef.current || !skillName) return;

      // FIX: Read the current text from the DOM directly to avoid React state / DOM desync.
      // When the user types quickly, React state (message) may not yet reflect the DOM value.
      // Using the DOM value ensures cursorPos and text always agree.
      const currentText = textareaRef.current.value;
      const cursorPos = textareaRef.current.selectionStart;
      const { newText, newCursorPos } = insertSkillMention(
        currentText,
        cursorPos,
        skillName,
      );

      setMessage(newText);
      onContextMenuClose?.();

      // Restore focus and set the cursor position
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          textareaRef.current.setSelectionRange(newCursorPos, newCursorPos);
        }
      }, 0);
    };

    window.addEventListener(
      'context:skillMentionSelect',
      handleSkillMentionSelectEvent as EventListener,
    );
    return () => {
      window.removeEventListener(
        'context:skillMentionSelect',
        handleSkillMentionSelectEvent as EventListener,
      );
    };
  }, [message, onContextMenuClose]);

  // Listen for fill-input-box events from AgentPage
  useEffect(() => {
    const handleFillInputEvent = (e: CustomEvent) => {
      const { text } = e.detail;

      if (text && typeof text === 'string') {
        setMessage(text);

        // Focus the input and move the cursor to the end
        setTimeout(() => {
          if (textareaRef.current) {
            textareaRef.current.focus();
            textareaRef.current.setSelectionRange(text.length, text.length);
          }
        }, 0);
      }
    };

    window.addEventListener(
      'agent:fillInput',
      handleFillInputEvent as EventListener,
    );
    return () => {
      window.removeEventListener(
        'agent:fillInput',
        handleFillInputEvent as EventListener,
      );
    };
  }, []);

  // Auto-resize textarea based on content and control scrollbar visibility
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      // Fixed height of 68 px, shows 2 lines of text
      textarea.style.height = '68px';

      // Show scrollbar only when content exceeds fixed height
      if (textarea.scrollHeight > 68) {
        textarea.style.overflowY = 'auto';
      } else {
        textarea.style.overflowY = 'hidden';
      }
    }
  }, [message]);

  // Monitor container height changes and update global CSS variable
  useEffect(() => {
    const updateHeight = () => {
      if (containerRef.current) {
        const height = containerRef.current.offsetHeight;
        document.documentElement.style.setProperty('--chat-input-height', `${height}px`);
      }
    };

    // Initial update
    updateHeight();

    const resizeObserver = new ResizeObserver(() => {
      updateHeight();
    });

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      resizeObserver.disconnect();
      // Optional: Reset variable on unmount, or leave it
      // document.documentElement.style.removeProperty('--chat-input-height');
    };
  }, []);

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

  // Handle clicking outside to close model dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        modelDropdownRef.current &&
        !modelDropdownRef.current.contains(event.target as Node)
      ) {
        setShowModelDropdown(false);
      }
    };

    if (showModelDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [showModelDropdown]);



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

        const originalSizeMB =
          Math.round((compressionResult.originalSize / (1024 * 1024)) * 10) /
          10;
        const compressedSizeMB =
          Math.round((compressionResult.compressedSize / (1024 * 1024)) * 10) /
          10;
        const savings = Math.round(
          (1 - compressionResult.compressionRatio) * 100,
        );

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
    console.log(`[ChatInput] handleFileSelect called:`, {
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
        console.log(`[ChatInput] Processing as Office file: ${file.name}`);
        await attachmentManager.addOffice(file);
      } else if (FileProcessor.isTextFile(file)) {
        console.log(`[ChatInput] Processing as Text file: ${file.name}`);
        await attachmentManager.addFile(file);
      } else {
        console.log(`[ChatInput] Processing as Others file: ${file.name}`);
        await attachmentManager.addOthers(file);
      }
      console.log(`[ChatInput] ✅ File processed successfully: ${file.name}`);
    } catch (error) {
      if ((error as Error)?.message?.startsWith('DUPLICATE:')) {
        alert(`This file is already attached: ${file.name}`);
      } else {
        console.error(`[ChatInput] ❌ handleFileSelect error for ${file.name}:`, error);
        console.error(`[ChatInput] Error details:`, {
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

  // Handle clipboard paste events - supports screenshot paste and text trimming
  const handlePaste = async (e: React.ClipboardEvent) => {
    const clipboardData = e.clipboardData;
    if (!clipboardData) {
      return;
    }

    // FIX: Prefer plain text over images.
    // When copying a table from Excel/Word the clipboard contains both text and image formats;
    // text should take priority.
    const hasTextContent = clipboardData.types.includes('text/plain');
    const textContent = clipboardData.getData('text/plain');
    
    // If there is non-empty text content, handle the paste manually and trim surrounding whitespace
    if (hasTextContent && textContent.trim().length > 0) {
      e.preventDefault();
      const trimmedText = textContent.trim();
      
      // Get the current cursor position
      const textarea = textareaRef.current;
      if (textarea) {
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const newMessage = message.slice(0, start) + trimmedText + message.slice(end);
        setMessage(newMessage);
        
        // Set the new cursor position and scroll to it
        const newCursorPos = start + trimmedText.length;
        requestAnimationFrame(() => {
          textarea.selectionStart = newCursorPos;
          textarea.selectionEnd = newCursorPos;
          // Scroll to the cursor position (bottom)
          textarea.scrollTop = textarea.scrollHeight;
        });
      } else {
        setMessage(message + trimmedText);
      }
      return;
    }

    // Check whether the current model supports images
    if (!supportsImages) {
      return;
    }

    // Check whether the clipboard contains image files (only process images when there is no text)
    const items = Array.from(clipboardData.items);
    const imageItems = items.filter((item) => item.type.startsWith('image/'));

    if (imageItems.length === 0) {
      return;
    }

    // Prevent default paste behaviour (only for pure image pastes)
    e.preventDefault();

    // Process each image item
    for (const item of imageItems) {
      const file = item.getAsFile();
      if (file) {

        // Validate image format
        if (!validateImageFile(file)) {
          alert(
            `Unsupported image format: ${file.type}. Please paste a PNG, JPEG, GIF, WEBP, or BMP image.`,
          );
          continue;
        }

        // Generate a file name for the pasted image
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const extension = file.type.split('/')[1] || 'png';
        const fileName = `screenshot-${timestamp}.${extension}`;

        // Create a new File object with the generated file name
        const renamedFile = new File([file], fileName, { type: file.type });

        await handleImageSelect(renamedFile);
      }
    }
  };

  // Drag-and-drop event handling
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragOver(true);
    }
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragOver(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;

    if (x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) {
      setIsDragOver(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
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
          console.log(`[ChatInput] 🔥 Got path from webUtils.getPathForFile: ${resolvedPath}`);
        } catch (err) {
          console.warn(`[ChatInput] ⚠️ webUtils.getPathForFile failed:`, err);
        }
      }
      
      // Fallback: check the path property on the File object
      if (!resolvedPath) {
        const filePath = (file as any).path;
        if (filePath) {
          resolvedPath = filePath;
          console.log(`[ChatInput] 📁 Using file.path: ${resolvedPath}`);
        }
      }
      
      // Attach the resolved path to the File object's fullPath property
      if (resolvedPath) {
        (file as any).fullPath = resolvedPath;
        console.log(`[ChatInput] ✅ Attached fullPath to file: ${resolvedPath}`);
      } else {
        console.log(`[ChatInput] ⚠️ No path available for file: ${file.name}`);
      }
      
      // Debug log
      console.log(`[ChatInput] 🔍 Dropped file: ${file.name}`, {
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
    if (imageFiles.length > 0 && supportsImages) {

      for (const file of imageFiles) {
        if (validateImageFile(file)) {
          await handleImageSelect(file);
        } else {
          alert(
            `Unsupported image format: ${file.type}. Please drop a PNG, JPEG, GIF, WEBP, or BMP image.`,
          );
        }
      }
    } else if (imageFiles.length > 0 && !supportsImages) {
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
        console.error('Electron file selection API not available, falling back to browser selection');
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
              console.error('Failed to stat file:', filePath);
              alert(`Failed to read file: ${filePath}`);
              continue;
            }

            if (isImage) {
              // Image file: read binary data as base64
              const fileContent = await window.electronAPI.fs.readFile(filePath, 'base64');
              
              if (!fileContent.success || !fileContent.content) {
                console.error('Failed to read image file:', filePath);
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
              
              console.log(`[ChatInput] 🔥 Image file selected with full path: ${filePath}`);
              
              if (supportsImages) {
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
              
              console.log(`[ChatInput] 📁 Non-image file selected with full path: ${filePath}, size: ${fileInfo.stats.size}`);
              
              await handleFileSelect(file);
            }
          }
        } catch (error) {
          console.error('Error processing selected files:', error);
          alert('An error occurred while processing the selected files.');
        } finally {
          setIsProcessing(false);
        }
      }
    } catch (error) {
      console.error('Error selecting files:', error);
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
            console.log(`[ChatInput] 🔥 Browser input - Got path from webUtils.getPathForFile: ${resolvedPath}`);
          } catch (err) {
            console.warn(`[ChatInput] ⚠️ Browser input - webUtils.getPathForFile failed:`, err);
          }
        }
        
        // Fallback: check the path property on the File object
        if (!resolvedPath) {
          const filePath = (file as any).path;
          if (filePath) {
            resolvedPath = filePath;
            console.log(`[ChatInput] 📁 Browser input - Using file.path: ${resolvedPath}`);
          }
        }
        
        // Attach the resolved path to the File object's fullPath property
        if (resolvedPath) {
          (file as any).fullPath = resolvedPath;
          console.log(`[ChatInput] ✅ Browser input - Attached fullPath to file: ${resolvedPath}`);
        } else {
          console.log(`[ChatInput] ⚠️ Browser input - No path available for file: ${file.name}`);
        }
        
        // Debug log
        console.log(`[ChatInput] 🔍 Browser selected file: ${file.name}`, {
          fullPath: (file as any).fullPath,
          type: file.type,
          size: file.size
        });
        
        // Intelligently determine how to handle the file based on its type
        if (FileProcessor.isImageFile(file)) {
          // Check whether the current model supports images
          if (supportsImages) {
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

  const handleSend = () => {
    // Only allow sending when idle and content is valid
    const isIdle = !chatStatus || chatStatus.chatStatus === 'idle';
    if (isIdle && attachmentManager.isValid() && !isProcessing) {
      const messageToSend = attachmentManager.createMessage();

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

      // Add to prompt history queue
      if (message.trim()) {
        profileDataManager.addPromptToHistory(message.trim());
      }

      // Send the message in unified format
      onSendMessage(messageToSend);

      setMessage('');
      attachmentManager.clear();

      if (textareaRef.current) {
        textareaRef.current.style.height = '68px';
        textareaRef.current.style.overflowY = 'hidden';
        textareaRef.current.focus();
      }
    }
  };

  // Get cursor position information
  const getCursorPosition = (): {
    position: number;
    isAtStart: boolean;
    isAtEnd: boolean;
    isInMiddle: boolean;
  } => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return { position: 0, isAtStart: true, isAtEnd: true, isInMiddle: false };
    }

    const position = textarea.selectionStart;
    const textLength = message.length;
    const isAtStart = position === 0;
    const isAtEnd = position === textLength;
    const isInMiddle = !isAtStart && !isAtEnd && textLength > 0;

    return { position, isAtStart, isAtEnd, isInMiddle };
  };

  // Set cursor position
  const setCursorPosition = (position: number) => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.setSelectionRange(position, position);
      textarea.focus();
    }
  };

  // Handle history navigation
  const handleHistoryNavigation = (direction: 'up' | 'down') => {
    const { isAtStart, isAtEnd, isInMiddle } = getCursorPosition();


    if (direction === 'up') {
      if (isAtStart) {
        // Cursor at start, switch to previous prompt
        const previousPrompt = profileDataManager.getPreviousPrompt();
        if (previousPrompt !== null) {
          isNavigatingHistory.current = true;
          setMessage(previousPrompt);
          // After selecting up, cursor defaults to start
          setTimeout(() => {
            setCursorPosition(0);
            isNavigatingHistory.current = false;
          }, 0);
        }
      } else {
        // Cursor at middle or end, move to start
        setCursorPosition(0);
      }
    } else if (direction === 'down') {
      if (isAtEnd) {
        // Cursor at end, switch to next prompt
        const nextPrompt = profileDataManager.getNextPrompt();
        if (nextPrompt !== null) {
          isNavigatingHistory.current = true;
          setMessage(nextPrompt);
          // After selecting down, cursor defaults to end
          setTimeout(() => {
            setCursorPosition(nextPrompt.length);
            isNavigatingHistory.current = false;
          }, 0);
        }
      } else {
        // Cursor at start or middle, move to end
        setCursorPosition(message.length);
      }
    }
  };

  // Get the bounding rect of the ChatInput container
  const getInputContainerRect = (): DOMRect | null => {
    // Get the chat-input-container element
    const container = textareaRef.current?.closest(
      '.chat-input-container',
    ) as HTMLElement;
    return container?.getBoundingClientRect() || null;
  };

  // Handle mention selection
  const handleMentionSelect = (option: ContextOption, fromKeyboard: boolean = false) => {
    if (!textareaRef.current) return;

    // If this is the default option (no relativePath or value), close the menu
    // and let the existing ContextMenu onSelect flow handle it
    if (!option.relativePath && !option.value) {
      
      if (fromKeyboard) {
        // Keyboard selection: close the menu and restore focus
        onContextMenuClose?.();
        setTimeout(() => {
          if (textareaRef.current) {
            textareaRef.current.focus();
          }
        }, 0);
      }
      
      // Do nothing here; let ContextMenu's onSelect call ChatView's handler
      return;
    }

    // FIX: Read the current text from the DOM directly to avoid React state / DOM desync.
    // When the user types quickly, React state (message) may not yet reflect the DOM value.
    // Using the DOM value ensures cursorPos and text always agree.
    const currentText = textareaRef.current.value;
    const cursorPos = textareaRef.current.selectionStart;
    const pathToInsert = option.value || option.relativePath || '';
    
    // Determine sourceType from the option type
    let sourceType: MentionSourceType | undefined;
    if (option.type === ContextMenuOptionType.KnowledgeBase) {
      sourceType = MentionSourceType.KnowledgeBase;
    } else if (option.type === ContextMenuOptionType.ChatSession) {
      sourceType = MentionSourceType.ChatSession;
    }
    
    const { newText, newCursorPos } = insertMention(
      currentText,
      cursorPos,
      pathToInsert,
      sourceType,
    );

    setMessage(newText);
    onContextMenuClose?.();

    // Restore focus and set the cursor position
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(newCursorPos, newCursorPos);
      }
    }, 0);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Context menu keyboard navigation (high priority)
    if (contextMenuState?.isOpen && contextMenuState.options.length > 0) {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        onContextMenuNavigate?.('up');
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        onContextMenuNavigate?.('down');
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab' || e.key === 'ArrowRight') {
        e.preventDefault();
        const selectedOption = contextMenuState.options[contextMenuState.selectedIndex];
        
        // Handle Skill-type options (triggered by #)
        if (selectedOption.type === ContextMenuOptionType.Skill && selectedOption.value) {
          // Fire the skill mention selection event
          window.dispatchEvent(new CustomEvent('context:skillMentionSelect', {
            detail: { skillName: selectedOption.value }
          }));
          return;
        }
        
        // For default options (no relativePath or value), delegate to ChatView
        if (!selectedOption.relativePath && !selectedOption.value) {
          // Handled via ChatView's ContextMenu onSelect
          window.dispatchEvent(new CustomEvent('context:keyboardSelect', {
            detail: { option: selectedOption }
          }));
        } else {
          // For options with an actual path (@ triggered file options), use handleMentionSelect
          handleMentionSelect(selectedOption, true);
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        onContextMenuClose?.();
        return;
      }
    }

    // Handle Enter key - must check IME composition state
    if (e.key === 'Enter') {
      // FIX: Check IME composition state; do not intercept while composing
      if (e.nativeEvent.isComposing) {
        // IME is composing; do not intercept Enter, let the IME handle it
        return;
      }
      
      // Alt+Enter (Windows) or Option+Enter (Mac) inserts a newline
      if (e.altKey) {
        e.preventDefault();
        const textarea = textareaRef.current;
        if (textarea) {
          const start = textarea.selectionStart;
          const end = textarea.selectionEnd;
          const newValue = message.substring(0, start) + '\n' + message.substring(end);
          setMessage(newValue);
          // Set the cursor position after the newline character
          setTimeout(() => {
            textarea.selectionStart = textarea.selectionEnd = start + 1;
          }, 0);
        }
        return;
      }
      
      // Plain Enter sends the message (Shift+Enter is handled natively by textarea for newlines)
      if (!e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      handleHistoryNavigation('up');
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      handleHistoryNavigation('down');
    }
  };

  // Handle input content changes, monitor editing behavior
  const handleMessageChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    const cursorPos = e.target.selectionStart;

    setMessage(newValue);

    // Check the trigger type (@ or #) using the unified triggerType check
    const triggerType = getContextMenuTriggerType(newValue, cursorPos);

    if (triggerType === ContextMenuTriggerType.Skill) {
      // # trigger: show the Skills list
      const query = getCurrentSkillSearchQuery(newValue, cursorPos);
      const inputRect = getInputContainerRect();
      if (inputRect) {
        onContextMenuTrigger?.(query, inputRect, ContextMenuTriggerType.Skill);
      }
    } else if (triggerType === ContextMenuTriggerType.Workspace) {
      // @ trigger: show workspace files
      const query = getCurrentSearchQuery(newValue, cursorPos);
      const inputRect = getInputContainerRect();
      if (inputRect) {
        onContextMenuTrigger?.(query, inputRect, ContextMenuTriggerType.Workspace);
      }
    } else {
      onContextMenuClose?.();
    }

    // If not navigating history, record as editing behavior
    if (!isNavigatingHistory.current) {
      profileDataManager.setCurrentEditingPrompt(newValue);
    }
  };

  // Handle model selection
  const handleModelSelect = async (modelId: string) => {
    if (isLoading) return;

    // FIX: Set pending state immediately to update the UI
    setPendingModel(modelId);

    try {
      const result = await updateModel(modelId);

      if (result.success) {
      } else {
        // FIX: If the update fails, clear the pending state
        setPendingModel(null);
      }
    } catch (error) {
      // FIX: If an error occurs, clear the pending state
      setPendingModel(null);
    }

    setShowModelDropdown(false);
  };

  // Get current model info and capabilities - uses displayModel
  const currentModelInfo = displayModel ? getModelById(displayModel) : null;
  const currentModelCapabilities = displayModel
    ? getModelCapabilities(displayModel)
    : null;
  const supportsImages = currentModelCapabilities?.supportsImages ?? false;

  // Get current content statistics
  const contentStats = attachmentManager.getStats();
  const allContent = attachmentManager.getContent();

  return (
    <div
      ref={containerRef}
      className={`chat-input-container ${isDragOver ? 'drag-over' : ''}`}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Error bar - embedded directly above the input area, higher priority than ApprovalBar */}
      {errorMessage && chatSessionId && onRetry && (
        <ErrorBar
          errorMessage={errorMessage}
          chatSessionId={chatSessionId}
          onRetry={onRetry}
        />
      )}
      
      {/* Batch approval bar - embedded directly above the input area */}
      {approvalRequests.length > 0 && onApproveRequest && onRejectRequest && (
        <ApprovalBar
          requests={approvalRequests}
          onApprove={onApproveRequest}
          onReject={onRejectRequest}
          onTimeoutAutoReject={onTimeoutAutoReject}
        />
      )}

      {/* Main input area - integrated design */}
      <div className="input-area">
        {/* Unified attachment display area */}
        {allContent.filter((part) => part.type !== 'text').length > 0 && (
          <div className="attachments-area">
            <div className="attachment-list">
              {allContent
                .map((part, originalIndex) => ({ part, originalIndex }))
                .filter(({ part }) => part.type !== 'text')
                .map(({ part, originalIndex }) => {
                  if (part.type === 'image') {
                    const imagePart = part as ImageContentPart;
                    const previewUrl = attachmentManager.getPreviewUrl(
                      imagePart.metadata.fileName,
                    );

                    return (
                      <div
                        key={`image-${originalIndex}`}
                        className="attachment-item image"
                        style={{ cursor: 'pointer' }}
                        onClick={() => {
                          const previewUrl = attachmentManager.getPreviewUrl(imagePart.metadata.fileName);
                          if (previewUrl) {
                            window.dispatchEvent(new CustomEvent('imageViewer:open', {
                              detail: {
                                images: [{
                                  id: `attachment-${originalIndex}`,
                                  url: previewUrl,
                                  alt: imagePart.metadata.fileName,
                                }],
                                initialIndex: 0,
                              }
                            }));
                          }
                        }}
                      >
                        {previewUrl && (
                          <img
                            src={previewUrl}
                            alt={imagePart.metadata.fileName}
                            className="attachment-image-preview"
                          />
                        )}
                        <div className="attachment-image-overlay">
                          <svg
                            className="attachment-file-icon"
                            fill="currentColor"
                            viewBox="0 0 20 20"
                          >
                            <path
                              fillRule="evenodd"
                              d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z"
                              clipRule="evenodd"
                            />
                          </svg>
                        </div>
                        <div className="attachment-image-name">
                          {imagePart.metadata.fileName}
                        </div>
                        <button
                          className="attachment-remove"
                          onClick={(e) => {
                            e.stopPropagation();
                            attachmentManager.removeContent(originalIndex);
                          }}
                          title="Remove attachment"
                        >
                          <svg fill="currentColor" viewBox="0 0 20 20">
                            <path
                              fillRule="evenodd"
                              d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                              clipRule="evenodd"
                            />
                          </svg>
                        </button>
                      </div>
                    );
                  }

                  if (part.type === 'file') {
                    const filePart = part as FileContentPart;

                    return (
                      <div
                        key={`file-${originalIndex}`}
                        className="attachment-item file"
                        style={{ cursor: 'pointer' }}
                        onClick={() => {
                          if (filePart.file.filePath) {
                            window.dispatchEvent(new CustomEvent('fileViewer:open', {
                              detail: {
                                file: {
                                  name: filePart.file.fileName,
                                  url: `file://${filePart.file.filePath}`,
                                  mimeType: filePart.file.mimeType,
                                  size: filePart.metadata?.fileSize,
                                  lastModified: filePart.metadata?.lastModified
                                    ? new Date(filePart.metadata.lastModified).toLocaleString()
                                    : undefined,
                                },
                              },
                            }));
                          }
                        }}
                      >
                        <div className="attachment-file-icon">
                          <FileTypeIcon fileName={filePart.file.fileName} size={16} />
                        </div>
                        <div className="attachment-file-info">
                          <div
                            className="attachment-name"
                            title={filePart.file.fileName}
                          >
                            {filePart.file.fileName}
                          </div>
                        </div>
                        <button
                          className="attachment-remove"
                          onClick={(e) => {
                            e.stopPropagation();
                            attachmentManager.removeContent(originalIndex);
                          }}
                          title="Remove file"
                        >
                          <svg fill="currentColor" viewBox="0 0 20 20">
                            <path
                              fillRule="evenodd"
                              d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                              clipRule="evenodd"
                            />
                          </svg>
                        </button>
                      </div>
                    );
                  }

                  if (part.type === 'office') {
                    const officePart = part as OfficeContentPart;

                    return (
                      <div
                        key={`office-${originalIndex}`}
                        className="attachment-item file"
                        style={{ cursor: 'pointer' }}
                        onClick={() => {
                          if (officePart.file.filePath) {
                            window.dispatchEvent(new CustomEvent('fileViewer:open', {
                              detail: {
                                file: {
                                  name: officePart.file.fileName,
                                  url: `file://${officePart.file.filePath}`,
                                  mimeType: officePart.file.mimeType,
                                  size: officePart.metadata?.fileSize,
                                  lastModified: officePart.metadata?.lastModified
                                    ? new Date(officePart.metadata.lastModified).toLocaleString()
                                    : undefined,
                                },
                              },
                            }));
                          }
                        }}
                      >
                        <div className="attachment-file-icon">
                          <FileTypeIcon fileName={officePart.file.fileName} size={16} />
                        </div>
                        <div className="attachment-file-info">
                          <div
                            className="attachment-name"
                            title={officePart.file.fileName}
                          >
                            {officePart.file.fileName}
                          </div>
                        </div>
                        <button
                          className="attachment-remove"
                          onClick={(e) => {
                            e.stopPropagation();
                            attachmentManager.removeContent(originalIndex);
                          }}
                          title="Remove Office file"
                        >
                          <svg fill="currentColor" viewBox="0 0 20 20">
                            <path
                              fillRule="evenodd"
                              d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                              clipRule="evenodd"
                            />
                          </svg>
                        </button>
                      </div>
                    );
                  }

                  if (part.type === 'others') {
                    const othersPart = part as OthersContentPart;

                    return (
                      <div
                        key={`others-${originalIndex}`}
                        className="attachment-item file"
                        style={{ cursor: 'pointer' }}
                        onClick={() => {
                          if (othersPart.file.filePath) {
                            window.dispatchEvent(new CustomEvent('fileViewer:open', {
                              detail: {
                                file: {
                                  name: othersPart.file.fileName,
                                  url: `file://${othersPart.file.filePath}`,
                                  mimeType: othersPart.file.mimeType,
                                  size: othersPart.metadata?.fileSize,
                                  lastModified: othersPart.metadata?.lastModified
                                    ? new Date(othersPart.metadata.lastModified).toLocaleString()
                                    : undefined,
                                },
                              },
                            }));
                          }
                        }}
                      >
                        <div className="attachment-file-icon">
                          <FileTypeIcon fileName={othersPart.file.fileName} size={16} />
                        </div>
                        <div className="attachment-file-info">
                          <div
                            className="attachment-name"
                            title={othersPart.file.fileName}
                          >
                            {othersPart.file.fileName}
                          </div>
                        </div>
                        <button
                          className="attachment-remove"
                          onClick={(e) => {
                            e.stopPropagation();
                            attachmentManager.removeContent(originalIndex);
                          }}
                          title="Remove file"
                        >
                          <svg fill="currentColor" viewBox="0 0 20 20">
                            <path
                              fillRule="evenodd"
                              d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                              clipRule="evenodd"
                            />
                          </svg>
                        </button>
                      </div>
                    );
                  }

                  return null;
                })}
            </div>
          </div>
        )}

        {/* Highlight layer (below the textarea) */}
        <MentionHighlight text={message} textareaRef={textareaRef} />

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={message}
          onChange={handleMessageChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={
            supportsImages
              ? 'Type a message, drag files/images, paste screenshot, @ to mention files, # for skills...'
              : 'Type a message, drag files, @ to mention files, # for skills...'
          }
          rows={1}
          className="chat-textarea"
        />

        {/* Button area */}
        <div className="button-area">
          {/* Unified attach button (click to open the menu, managed by AppLayout) */}
          <button
            className="attachment-button file-attachment-button"
            onClick={(e) => {
              if (onAttachMenuToggle) {
                onAttachMenuToggle(e.currentTarget);
              }
            }}
            disabled={isProcessing}
            title="Attach"
          >
            <svg
              className="attachment-icon"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <mask id="mask0_613_722" style={{maskType: 'alpha'}} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
                <path d="M12 3.25C12.4142 3.25 12.75 3.58579 12.75 4V11.25H20C20.4142 11.25 20.75 11.5858 20.75 12C20.75 12.4142 20.4142 12.75 20 12.75H12.75V20C12.75 20.4142 12.4142 20.75 12 20.75C11.5858 20.75 11.25 20.4142 11.25 20V12.75H4C3.58579 12.75 3.25 12.4142 3.25 12C3.25 11.5858 3.58579 11.25 4 11.25H11.25V4C11.25 3.58579 11.5858 3.25 12 3.25Z" fill="#242424"/>
              </mask>
              <g mask="url(#mask0_613_722)">
                <rect width="24" height="24" fill="#272320"/>
              </g>
            </svg>
          </button>

          {/* Edit Agent button */}
          <button
            className="attachment-button edit-agent-button"
            onClick={(e) => {
              if (onEditAgentMenuToggle) {
                onEditAgentMenuToggle(e.currentTarget);
              }
            }}
            title="Edit Agent (MCP Tools, System Prompt & Context Enhancement)"
          >
            <svg
              className="attachment-icon"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <mask id="mask0_613_682" style={{maskType: 'alpha'}} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
                <path d="M8.75 13.5C10.2862 13.5 11.5735 14.5658 11.9126 15.9983L21.25 16C21.6642 16 22 16.3358 22 16.75C22 17.1297 21.7178 17.4435 21.3518 17.4932L21.25 17.5L11.9129 17.5007C11.5741 18.9337 10.2866 20 8.75 20C7.21345 20 5.92594 18.9337 5.58712 17.5007L2.75 17.5C2.33579 17.5 2 17.1642 2 16.75C2 16.3703 2.28215 16.0565 2.64823 16.0068L2.75 16L5.58712 15.9993C5.92594 14.5663 7.21345 13.5 8.75 13.5ZM8.75 15C7.98586 15 7.33611 15.4898 7.09753 16.1725L7.07696 16.2352L7.03847 16.3834C7.01326 16.5016 7 16.6242 7 16.75C7 16.9048 7.02011 17.055 7.05785 17.1979L7.09766 17.3279L7.12335 17.3966C7.38055 18.0431 8.01191 18.5 8.75 18.5C9.51376 18.5 10.1632 18.0107 10.4021 17.3285L10.4422 17.1978L10.4251 17.2581C10.4738 17.0973 10.5 16.9267 10.5 16.75C10.5 16.6452 10.4908 16.5425 10.4731 16.4428L10.4431 16.3057L10.4231 16.2353L10.3763 16.1024C10.1188 15.4565 9.48771 15 8.75 15ZM15.25 4C16.7866 4 18.0741 5.06632 18.4129 6.49934L21.25 6.5C21.6642 6.5 22 6.83579 22 7.25C22 7.6297 21.7178 7.94349 21.3518 7.99315L21.25 8L18.4129 8.00066C18.0741 9.43368 16.7866 10.5 15.25 10.5C13.7134 10.5 12.4259 9.43368 12.0871 8.00066L2.75 8C2.33579 8 2 7.66421 2 7.25C2 6.8703 2.28215 6.55651 2.64823 6.50685L2.75 6.5L12.0874 6.49833C12.4265 5.06582 13.7138 4 15.25 4ZM15.25 5.5C14.4859 5.5 13.8361 5.98976 13.5975 6.6725L13.577 6.73515L13.5385 6.88337C13.5133 7.0016 13.5 7.12425 13.5 7.25C13.5 7.40483 13.5201 7.55497 13.5579 7.69794L13.5977 7.82787L13.6234 7.89664C13.8805 8.54307 14.5119 9 15.25 9C16.0138 9 16.6632 8.51073 16.9021 7.82852L16.9422 7.69781L16.9251 7.75808C16.9738 7.59729 17 7.4267 17 7.25C17 7.14518 16.9908 7.04251 16.9731 6.94275L16.9431 6.80565L16.9231 6.73529L16.8763 6.60236C16.6188 5.95647 15.9877 5.5 15.25 5.5Z" fill="#242424"/>
              </mask>
              <g mask="url(#mask0_613_682)">
                <rect width="24" height="24" fill="#272320"/>
              </g>
            </svg>
          </button>

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
          {enableVoiceInput && voiceInputUserEnabled && (
            <VoiceInputButton
              onTranscript={(transcript, isFinal) => {
                if (isFinal && transcript.trim()) {
                  // Append the final transcript to the current message
                  setMessage(prev => {
                    const newText = prev ? `${prev} ${transcript}` : transcript;
                    attachmentManager.setText(newText);
                    return newText;
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
              disabled={isProcessing || !!isReplaying || !!(chatStatus && chatStatus.chatStatus !== 'idle')}
            />
          )}

          {/* Send Button - on the right side */}
          <div className="right-buttons-group">
            {/* Model selector button */}
            <div className="model-selector" ref={modelDropdownRef}>
              <button
                className="model-button"
                onClick={() => setShowModelDropdown(!showModelDropdown)}
                disabled={isLoading}
                title="Select AI Model"
              >
                <span className="model-name">
                  {currentModelInfo?.name || 'Select Model'}
                </span>
                <svg
                  className={`dropdown-arrow ${
                    showModelDropdown ? 'rotated' : ''
                  }`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </button>

              {/* Model dropdown */}
              {showModelDropdown && (
                <div className="model-dropdown">
                  <div className="model-list">
                    {availableModels.map((model) => (
                      <button
                        key={model.id}
                        className={`model-option ${
                          displayModel === model.id ? 'selected' : ''
                        }`}
                        onClick={() => handleModelSelect(model.id)}
                        disabled={isLoading}
                      >
                        <div className="model-info chat-input-vertical">
                          <span className="model-option-name">{model.name}</span>
                          <div className="model-badges">
                            {(model.capabilities.family.includes('o3') ||
                              model.capabilities.family.includes('o4')) && (
                              <span className="badge reasoning">Reasoning</span>
                            )}
                            {model.capabilities.supports.tool_calls && (
                              <span className="badge tools">Tools</span>
                            )}
                            {model.capabilities.supports.vision && (
                              <span className="badge files">Image</span>
                            )}
                          </div>
                        </div>
                        {displayModel === model.id && (
                          <svg
                            className="check-icon"
                            fill="currentColor"
                            viewBox="0 0 20 20"
                          >
                            <path
                              fillRule="evenodd"
                              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                              clipRule="evenodd"
                            />
                          </svg>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Send/Cancel button - switches in place based on chat status */}
          {(!chatStatus || chatStatus.chatStatus === 'idle') ? (
            /* Send button - shown when chat status is idle or null */
            <button
              onClick={handleSend}
              disabled={!attachmentManager.isValid() || isProcessing || !!isReplaying}
              className="send-button"
              title="Send Message (Enter)"
            >
              {isProcessing ? (
                <svg
                  className="send-icon animate-spin"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
              ) : (
                <svg
                  className="send-icon"
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <mask id="mask0_342_2145" style={{maskType: 'alpha'}} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
                    <path d="M4.20938 10.7327C3.92369 11.0326 3.93523 11.5074 4.23516 11.7931C4.53509 12.0787 5.00982 12.0672 5.29551 11.7673L11.25 5.516V20.25C11.25 20.6642 11.5858 21 12 21C12.4142 21 12.75 20.6642 12.75 20.25V5.51565L18.7048 11.7673C18.9905 12.0672 19.4652 12.0787 19.7652 11.7931C20.0651 11.5074 20.0766 11.0326 19.791 10.7327L12.7243 3.31379C12.5632 3.14474 12.3578 3.04477 12.1443 3.01386C12.0976 3.00477 12.0494 3 12 3C11.9503 3 11.9017 3.00483 11.8547 3.01406C11.6417 3.04518 11.4368 3.14509 11.2761 3.31379L4.20938 10.7327Z" fill="#242424"/>
                  </mask>
                  <g mask="url(#mask0_342_2145)">
                    <rect width="24" height="24" fill="#E2DDD9"/>
                  </g>
                </svg>
              )}
            </button>
          ) : (
            /* Cancel button - shown when chat status is not idle, replaces the Send button */
            onCancelChat && (
              <button
                onClick={onCancelChat}
                className="send-button cancel-button" // send-button as base style, cancel-button as modifier
                title="Cancel Chat"
              >
                <svg
                  className="cancel-icon"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  width="24"
                  height="24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            )
          )}
          </div>
        </div>
      </div>

      {/* Content statistics display (development mode only) */}
      {process.env.NODE_ENV === 'development' && contentStats.totalSize > 0 && (
        <div className="content-stats">
          📊 Images: {contentStats.imageCount} | Files: {contentStats.fileCount}{' '}
          | Others: {contentStats.othersCount || 0} | Size:{' '}
          {formatFileSize(contentStats.totalSize)} | Est. Tokens:{' '}
          {contentStats.estimatedTokens}
        </div>
      )}
    </div>
  );
};

export default ChatInput;