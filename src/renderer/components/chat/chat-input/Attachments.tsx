import React, { memo } from 'react';
import { ImageContentPart, FileContentPart, OfficeContentPart, OthersContentPart, Message, UserMessage } from '@shared/types/chatTypes';
import {
  ContentPartFactory,
  ContentConverter,
  ContentAnalyzer,
  FileProcessor,
  formatFileSize,
} from '@/lib/utilities/contentUtils';
import FileTypeIcon from '../../ui/FileTypeIcon';
import { createLogger } from '@/lib/utilities/logger';
import { atom } from '@/atom';

const logger = createLogger('[ChatAttachment]');

type AttachmentPart = ImageContentPart | FileContentPart | OfficeContentPart | OthersContentPart;
const zeroAttachments: AttachmentPart[] = [];

export function createAttachmentsAtom() {
  return atom(zeroAttachments, (get, set) => {
  const previewUrls: Map<string, string> = new Map();

  // Check whether an identical attachment already exists (by fullPath or fileName+size)
  function isDuplicate(fileName: string, fileSize: number, fullPath?: string): boolean {
    return get().some(part => {
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

  // Add image content
  async function addImage(file: File): Promise<void> {
    if (isDuplicate(file.name, file.size, (file as any).fullPath)) {
      logger.debug(`[AttachmentManager] Duplicate image skipped: ${file.name}`);
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
      previewUrls.set(imageContent.metadata.fileName, previewUrl);
      set([...get(), imageContent]);
    } catch (error) {
      throw error;
    }
  }

  // Add file content
  async function addFile(file: File): Promise<void> {
    logger.debug(`[AttachmentManager] addFile called: ${file.name}, size=${file.size}, type=${file.type}`);
    if (isDuplicate(file.name, file.size, (file as any).fullPath)) {
      logger.debug(`[AttachmentManager] Duplicate file skipped: ${file.name}`);
      throw new Error(`DUPLICATE: ${file.name}`);
    }
    try {
      const fileContent = await ContentConverter.fileToFileContent(file);
      logger.debug(`[AttachmentManager] ✅ addFile success: ${file.name}`);
      set([...get(), fileContent]);
    } catch (error) {
      logger.error(`[AttachmentManager] ❌ addFile error:`, error);
      throw error;
    }
  }

  // Add other file-type content
  async function addOthers(file: File): Promise<void> {
    logger.debug(`[AttachmentManager] addOthers called: ${file.name}, size=${file.size}, type=${file.type}`);
    if (isDuplicate(file.name, file.size, (file as any).fullPath)) {
      logger.debug(`[AttachmentManager] Duplicate others file skipped: ${file.name}`);
      throw new Error(`DUPLICATE: ${file.name}`);
    }
    try {
      const othersContent = await ContentConverter.fileToOthersContent(file);
      logger.debug(`[AttachmentManager] ✅ addOthers success: ${file.name}`);
      set([...get(), othersContent]);
    } catch (error) {
      logger.error(`[AttachmentManager] ❌ addOthers error:`, error);
      throw error;
    }
  }

  // Add Office document content
  async function addOffice(file: File): Promise<void> {
    logger.debug(`[AttachmentManager] addOffice called: ${file.name}, size=${file.size}, type=${file.type}, fullPath=${(file as any).fullPath}`);
    if (isDuplicate(file.name, file.size, (file as any).fullPath)) {
      logger.debug(`[AttachmentManager] Duplicate office file skipped: ${file.name}`);
      throw new Error(`DUPLICATE: ${file.name}`);
    }
    try {
      const officeContent = await ContentConverter.fileToOfficeContent(file);
      logger.debug(`[AttachmentManager] ✅ addOffice success: ${file.name}`);
      set([...get(), officeContent]);
    } catch (error) {
      logger.error(`[AttachmentManager] ❌ addOffice error:`, error);
      throw error;
    }
  }

  // Remove content
  function removeContent(index: number) {
    const part = get()[index];
    if (part) {
      // Clean up preview URL
      if (part.type === 'image') {
        const fileName = (part as ImageContentPart).metadata.fileName;
        const previewUrl = previewUrls.get(fileName);
        if (previewUrl) {
          URL.revokeObjectURL(previewUrl);
          previewUrls.delete(fileName);
        }
      }

      get().splice(index, 1);
      set([...get()]);
    }
  }

  // Get preview URL
  function getPreviewUrl(fileName: string): string | undefined {
    return previewUrls.get(fileName);
  }

  // Clear all content
  function clear() {
    // Clean up all preview URLs
    previewUrls.forEach(url => URL.revokeObjectURL(url));
    previewUrls.clear();

    set(zeroAttachments);
  }

  // Load an existing multipart message into the manager for editing.
  function loadFromMessage(message: Message): void {
    clear();

    const content = message.content
      .filter((part) => part.type !== 'text')
      .map((part) => ({
      ...part,
      ...(part.type === 'image'
        ? {
            image_url: { ...(part as ImageContentPart).image_url },
            metadata: { ...(part as ImageContentPart).metadata },
          }
        : part.type === 'file'
          ? {
              file: { ...(part as FileContentPart).file },
              metadata: { ...(part as FileContentPart).metadata },
            }
          : part.type === 'office'
            ? {
                file: { ...(part as OfficeContentPart).file },
                metadata: { ...(part as OfficeContentPart).metadata },
              }
            : part.type === 'others'
              ? {
                  file: { ...(part as OthersContentPart).file },
                  metadata: { ...(part as OthersContentPart).metadata },
                }
              : {}),
    })) as AttachmentPart[];

    content.forEach((part) => {
      if (part.type === 'image') {
        const imagePart = part as ImageContentPart;
        previewUrls.set(imagePart.metadata.fileName, imagePart.image_url.url);
      }
    });

    set(content);
  }

  // Check whether the content is valid
  function isValid(): boolean {
    return get().length > 0;
  }

  // Create message
  function createMessage(text: string, overrides?: { id?: string; timestamp?: number }): UserMessage {
    return {
      id: overrides?.id || `msg_user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      role: 'user',
      content: [ContentPartFactory.createText(text), ...get()],
      timestamp: overrides?.timestamp ?? Date.now()
    };
  }

  return {
    addImage,
    addFile,
    addOthers,
    addOffice,
    removeContent,
    getPreviewUrl,
    clear,
    loadFromMessage,
    isValid,
    createMessage,
  }
  });
}

export type AttachmentsStateAtom = ReturnType<typeof createAttachmentsAtom>;


function renderAttachment(
  manager: { getPreviewUrl: (fileName: string) => string | undefined; removeContent: (index: number) => void },
  part: AttachmentPart,
  originalIndex: number
) {
  if (part.type === 'image') {
    const imagePart = part as ImageContentPart;
    const previewUrl = manager.getPreviewUrl(
      imagePart.metadata.fileName,
    );

    return (
      <div
        key={`image-${originalIndex}`}
        className="attachment-item image"
        style={{ cursor: 'pointer' }}
        onClick={() => {
          const previewUrl = manager.getPreviewUrl(imagePart.metadata.fileName);
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
            manager.removeContent(originalIndex);
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
            manager.removeContent(originalIndex);
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
            manager.removeContent(originalIndex);
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
            manager.removeContent(originalIndex);
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
}


function List({ attachmentsStateAtom }: { attachmentsStateAtom: AttachmentsStateAtom }) {
  const [list, manager] = attachmentsStateAtom.use();

  const nodes: React.ReactNode[] = [];
  list.forEach((part, index) => {
    const node = renderAttachment(manager, part, index);
    if (node) nodes.push(node);
  });
  if (nodes.length === 0) return null;
  return (
    <div className="attachments-area">
      <div className="attachment-list">{nodes}</div>
    </div>
  );
}
export const AttachmentList = memo(List);

function Status({ attachmentsStateAtom }: { attachmentsStateAtom: AttachmentsStateAtom }) {
  const list = attachmentsStateAtom.useData();
  const contentStats = ContentAnalyzer.analyzeContent(list);
  if (contentStats.totalSize === 0) return null;
  return (
    <div className="content-stats">
      📊 Images: {contentStats.imageCount} | Files: {contentStats.fileCount}{' '}
      | Others: {contentStats.othersCount || 0} | Size:{' '}
      {formatFileSize(contentStats.totalSize)} | Est. Tokens:{' '}
      {contentStats.estimatedTokens}
    </div>
  );
}
export const AttachmentsStatus = memo(Status);
