import {
  useCallback,
  useEffect,
  useState,
  type ChangeEvent,
  type DragEvent,
  type RefObject,
} from 'react';
import { validateImageFile } from '@shared/types/chatTypes';
import { screenshotApi } from '../../../ipc/screenshot-main';
import { FileProcessor } from '../../../lib/utilities/contentUtils';
import {
  smartCompressImageVSCodeOfficial,
  shouldCompressImage,
} from '../../../lib/utilities/imageCompression';
import { createLogger } from '../../../lib/utilities/logger';
import type { AttachmentsStateAtom } from './Attachments';
import { useI18n } from '../../../lib/i18n/useI18n';

const logger = createLogger('[ChatInput]');

type AttachmentManager = ReturnType<AttachmentsStateAtom['useChange']>;

interface UseChatInputAttachmentsOptions {
  attachmentManager: AttachmentManager;
  fileInputRef: RefObject<HTMLInputElement>;
  effectiveSupportsImages: boolean;
  shouldLockComposeUi: boolean;
  isExternalAgent: boolean;
}

function getFileTypeFromPath(filePath: string): string {
  const extension = filePath.toLowerCase().split('.').pop() || '';
  const mimeMap: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    txt: 'text/plain',
    md: 'text/markdown',
    js: 'text/javascript',
    ts: 'text/typescript',
    json: 'application/json',
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  };
  return mimeMap[extension] || 'application/octet-stream';
}

export function useChatInputAttachments(options: UseChatInputAttachmentsOptions) {
  const { t } = useI18n();
  const {
    attachmentManager,
    fileInputRef,
    effectiveSupportsImages,
    shouldLockComposeUi,
    isExternalAgent,
  } = options;
  const [isDragOver, setIsDragOver] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  const handleImageSelect = useCallback(async (file: File) => {
    if (!validateImageFile(file)) {
      alert(t('chat.attachments.unsupportedImage'));
      return;
    }

    setIsProcessing(true);
    try {
      let processedFile = file;
      if (shouldCompressImage(file)) {
        const compressionResult = await smartCompressImageVSCodeOfficial(file);
        processedFile = compressionResult.compressedFile;
      }
      await attachmentManager.addImage(processedFile);
    } catch (error) {
      if ((error as Error)?.message?.startsWith('DUPLICATE:')) {
        alert(t('chat.attachments.duplicateFile', { name: file.name }));
      } else {
        alert(t('chat.attachments.imageProcessingFailed'));
      }
    } finally {
      setIsProcessing(false);
    }
  }, [attachmentManager, t]);

  const handleFileSelect = useCallback(async (file: File) => {
    logger.debug('[ChatInput] handleFileSelect called:', {
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
      logger.debug(`[ChatInput] File processed successfully: ${file.name}`);
    } catch (error) {
      if ((error as Error)?.message?.startsWith('DUPLICATE:')) {
        alert(t('chat.attachments.duplicateFile', { name: file.name }));
      } else {
        logger.error(`[ChatInput] handleFileSelect error for ${file.name}:`, error);
        logger.error('[ChatInput] Error details:', {
          message: (error as Error)?.message,
          stack: (error as Error)?.stack,
          name: (error as Error)?.name,
        });
        alert(t('chat.attachments.fileProcessingFailed'));
      }
    } finally {
      setIsProcessing(false);
    }
  }, [attachmentManager, t]);

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    if (shouldLockComposeUi || isExternalAgent) {
      return;
    }
    e.preventDefault();
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragOver(true);
    }
  }, [isExternalAgent, shouldLockComposeUi]);

  const handleDragEnter = useCallback((e: DragEvent<HTMLDivElement>) => {
    if (shouldLockComposeUi || isExternalAgent) {
      return;
    }
    e.preventDefault();
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragOver(true);
    }
  }, [isExternalAgent, shouldLockComposeUi]);

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
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
  }, [shouldLockComposeUi]);

  const handleDrop = useCallback(async (e: DragEvent<HTMLDivElement>) => {
    if (shouldLockComposeUi || isExternalAgent) {
      e.preventDefault();
      setIsDragOver(false);
      return;
    }
    e.preventDefault();
    setIsDragOver(false);

    const files = Array.from(e.dataTransfer.files);
    for (const file of files) {
      let resolvedPath: string | undefined;
      if (window.electronAPI?.fs?.getPathForFile) {
        try {
          resolvedPath = window.electronAPI.fs.getPathForFile(file);
          logger.debug(`[ChatInput] Got path from webUtils.getPathForFile: ${resolvedPath}`);
        } catch (err) {
          logger.warn('[ChatInput] webUtils.getPathForFile failed:', err);
        }
      }

      if (!resolvedPath) {
        const filePath = (file as any).path;
        if (filePath) {
          resolvedPath = filePath;
          logger.debug(`[ChatInput] Using file.path: ${resolvedPath}`);
        }
      }

      if (resolvedPath) {
        (file as any).fullPath = resolvedPath;
        logger.debug(`[ChatInput] Attached fullPath to file: ${resolvedPath}`);
      } else {
        logger.debug(`[ChatInput] No path available for file: ${file.name}`);
      }

      logger.debug(`[ChatInput] Dropped file: ${file.name}`, {
        fullPath: (file as any).fullPath,
        type: file.type,
        size: file.size,
      });
    }

    const imageFiles = files.filter((file) => FileProcessor.isImageFile(file));
    const textFiles = files.filter((file) => FileProcessor.isTextFile(file));
    const officeFiles = files.filter((file) => FileProcessor.isOfficeFile(file));
    const otherFiles = files.filter((file) => FileProcessor.isOthersFile(file));

    if (imageFiles.length > 0 && effectiveSupportsImages) {
      for (const file of imageFiles) {
        if (validateImageFile(file)) {
          await handleImageSelect(file);
        } else {
          alert(t('chat.attachments.unsupportedDroppedImage', { type: file.type }));
        }
      }
    } else if (imageFiles.length > 0 && !effectiveSupportsImages) {
      alert(t('chat.attachments.imagesUnsupported'));
    }

    for (const file of officeFiles) {
      await handleFileSelect(file);
    }
    for (const file of textFiles) {
      await handleFileSelect(file);
    }
    for (const file of otherFiles) {
      await handleFileSelect(file);
    }
  }, [
    effectiveSupportsImages,
    handleFileSelect,
    handleImageSelect,
    isExternalAgent,
    shouldLockComposeUi,
    t,
  ]);

  const handleElectronFileSelect = useCallback(async () => {
    try {
      if (!window.electronAPI?.fs?.selectFiles) {
        logger.error('Electron file selection API not available, falling back to browser selection');
        fileInputRef.current?.click();
        return;
      }

      const result = await window.electronAPI.fs.selectFiles({
        title: t('chat.attachments.selectFilesTitle'),
        allowMultiple: true,
      });

      if (result.success && result.filePaths && result.filePaths.length > 0) {
        setIsProcessing(true);
        try {
          for (const filePath of result.filePaths) {
            const fileInfo = await window.electronAPI.fs.stat(filePath);
            const fileName = filePath.split('/').pop() || filePath.split('\\').pop() || 'unknown';
            const fileType = getFileTypeFromPath(filePath);
            const isImage = fileType.startsWith('image/');

            if (!fileInfo.success || !fileInfo.stats) {
              logger.error('Failed to stat file:', filePath);
              alert(t('chat.attachments.readFileFailed', { path: filePath }));
              continue;
            }

            if (isImage) {
              const fileContent = await window.electronAPI.fs.readFile(filePath, 'base64');
              if (!fileContent.success || !fileContent.content) {
                logger.error('Failed to read image file:', filePath);
                alert(t('chat.attachments.readFileFailed', { path: filePath }));
                continue;
              }

              const binaryString = atob(fileContent.content);
              const bytes = new Uint8Array(binaryString.length);
              for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
              }
              const file = new File([new Blob([bytes], { type: fileType })], fileName, {
                type: fileType,
                lastModified: fileInfo.stats.mtime,
              });
              (file as any).fullPath = filePath;
              logger.debug(`[ChatInput] Image file selected with full path: ${filePath}`);

              if (effectiveSupportsImages) {
                await handleImageSelect(file);
              } else {
                alert(t('chat.attachments.imageIgnored', { name: file.name }));
              }
            } else {
              const file = new File([], fileName, {
                type: fileType,
                lastModified: fileInfo.stats.mtime,
              });
              Object.defineProperty(file, 'size', { value: fileInfo.stats.size });
              (file as any).fullPath = filePath;
              logger.debug(`[ChatInput] Non-image file selected with full path: ${filePath}, size: ${fileInfo.stats.size}`);
              await handleFileSelect(file);
            }
          }
        } catch (error) {
          logger.error('Error processing selected files:', error);
          alert(t('chat.attachments.selectedFilesProcessingFailed'));
        } finally {
          setIsProcessing(false);
        }
      }
    } catch (error) {
      logger.error('Error selecting files:', error);
      alert(t('chat.attachments.fileSelectionFailed'));
    }
  }, [effectiveSupportsImages, fileInputRef, handleFileSelect, handleImageSelect, t]);

  const handleUnifiedFileInputChange = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) {
      for (const file of Array.from(files)) {
        let resolvedPath: string | undefined;
        if (window.electronAPI?.fs?.getPathForFile) {
          try {
            resolvedPath = window.electronAPI.fs.getPathForFile(file);
            logger.debug(`[ChatInput] Browser input - Got path from webUtils.getPathForFile: ${resolvedPath}`);
          } catch (err) {
            logger.warn('[ChatInput] Browser input - webUtils.getPathForFile failed:', err);
          }
        }

        if (!resolvedPath) {
          const filePath = (file as any).path;
          if (filePath) {
            resolvedPath = filePath;
            logger.debug(`[ChatInput] Browser input - Using file.path: ${resolvedPath}`);
          }
        }

        if (resolvedPath) {
          (file as any).fullPath = resolvedPath;
          logger.debug(`[ChatInput] Browser input - Attached fullPath to file: ${resolvedPath}`);
        } else {
          logger.debug(`[ChatInput] Browser input - No path available for file: ${file.name}`);
        }

        logger.debug(`[ChatInput] Browser selected file: ${file.name}`, {
          fullPath: (file as any).fullPath,
          type: file.type,
          size: file.size,
        });

        if (FileProcessor.isImageFile(file)) {
          if (effectiveSupportsImages) {
            await handleImageSelect(file);
          } else {
            alert(t('chat.attachments.imageIgnored', { name: file.name }));
          }
        } else {
          await handleFileSelect(file);
        }
      }
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [effectiveSupportsImages, fileInputRef, handleFileSelect, handleImageSelect, t]);

  useEffect(() => {
    const handleSelectFiles = () => {
      void handleElectronFileSelect();
    };
    const handleScreenshot = async () => {
      if (isProcessing) {
        return;
      }
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
  }, [handleElectronFileSelect, handleImageSelect, isProcessing]);

  return {
    isDragOver,
    isProcessing,
    handleDragOver,
    handleDragEnter,
    handleDragLeave,
    handleDrop,
    handleImageSelect,
    handleElectronFileSelect,
    handleUnifiedFileInputChange,
  };
}
