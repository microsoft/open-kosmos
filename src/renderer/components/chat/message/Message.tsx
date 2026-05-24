import React, { useEffect, useState, memo } from 'react';
import FileTypeIcon from '../../ui/FileTypeIcon';
import { Message as MessageType, MessageHelper, UserMessage } from '@shared/types/chatTypes';
import { StreamingV2Message } from '../../streaming/StreamingV2Message';
import '../../../styles/Message.css';
import '../../../styles/markdown-render.css';
import GeneratedFileCards, { GeneratedFileCardItem, normalizePresentedFilesToGeneratedFileItems, PresentedFile } from './GeneratedFileCards';
import GeneratedScheduleCards from './GeneratedScheduleCards';
import SayHiActionItems, { parseSayHiContent } from './SayHiActionItems';
import PmProjectSayHiCards, { parsePmSayHiCards } from './PmProjectSayHiCards';
import PmAgentSayHiCards, { parsePmAgentSayHiMessage } from './PmAgentSayHiCards';
import { createLogger } from '../../../lib/utilities/logger';
import { ImageGalleryMenuAtom } from '../../menu/ImageGalleryContextMenu';
const logger = createLogger('[Message]');

const SCHEDULE_JOB_ID_PATTERN = /sched_\d{14}(?:_[a-z0-9-]+_[a-z0-9]+|_[a-z0-9]{8,16})/gi;

// Message segment interface definition
interface MessageSegment {
  type: 'text' | 'image' | 'image-placeholder' | 'image-gallery';
  content: string;
  id: string;
  originalMessageId: string;
  segmentIndex: number;
  imageRegistry?: Map<string, any>; // stores the image registry for the image-gallery type
}

interface MessageProps {
  chatId?: string;
  message: MessageType;
  isStreaming?: boolean; // indicates whether the message is currently streaming
  onContentChange?: (newContent: string, heightChanged: boolean) => void; // scroll management callback
  cachedFilePaths?: Array<{ path: string; exists: boolean }>; // Cached file paths from backend for rendering
  presentedFiles?: PresentedFile[]; // Files from present tool to display
  canEditUserMessage?: boolean;
  onEditUserMessage?: (msg: UserMessage) => void;
}

// 🆕 Check whether content contains the new image format (checks for IMAGE_REGISTRY tags)
const hasNewImageFormat = (content: string): boolean => {
  const trimmedContent = content.trim();

  // Case 1: the message contains a complete <IMAGE_REGISTRY> tag pair (both opening and closing tags)
  const hasCompleteRegistry = /<IMAGE_REGISTRY>\s*([\s\S]*?)\s*<\/IMAGE_REGISTRY>/.test(trimmedContent);

  if (hasCompleteRegistry) {
    return true;
  }

  // Case 2: incomplete tags during streaming
  // 🔥 Fix: only treat <IMAGE_REGISTRY> as a real image tag when it is immediately followed by a newline,
  // to exclude cases where <IMAGE_REGISTRY> is merely mentioned in plain text
  const hasRegistryStartWithNewline = /<IMAGE_REGISTRY>\s*\n/.test(trimmedContent);

  if (hasRegistryStartWithNewline) {
    return true;
  }

  // Case 3: the message equals an IMAGE_REGISTRY prefix (for incomplete state during streaming)
  // Only considered new format when the entire message is this prefix
  const REGISTRY_PREFIXES = [
    '<', '<I', '<IM', '<IMA', '<IMAG', '<IMAGE', '<IMAGE_',
    '<IMAGE_R', '<IMAGE_RE', '<IMAGE_REG', '<IMAGE_REGI',
    '<IMAGE_REGIS', '<IMAGE_REGIST', '<IMAGE_REGISTR'
  ];

  // Note: uses === equality check, not startsWith
  return REGISTRY_PREFIXES.includes(trimmedContent);
};


// 🆕 Parse new-format image content — IMAGE_REGISTRY format (no IMG_REF)
const parseNewFormatMessage = (content: string, messageId: string, isStreaming: boolean = false): MessageSegment[] => {
  logger.debug('🎬 [parseNewFormatMessage] START - messageId:', messageId, 'isStreaming:', isStreaming);
  logger.debug('📝 [parseNewFormatMessage] Content length:', content.length);

  const segments: MessageSegment[] = [];
  let segmentIndex = 0;
  let currentPosition = 0;

  // 🔥 Fix: use a global regex to find all IMAGE_REGISTRY tag pairs
  const registryRegex = /<IMAGE_REGISTRY>\s*([\s\S]*?)\s*<\/IMAGE_REGISTRY>/g;
  let match;
  let foundAnyRegistry = false;

  // Process all complete IMAGE_REGISTRY tag pairs
  while ((match = registryRegex.exec(content)) !== null) {
    foundAnyRegistry = true;
    const matchStart = match.index;
    const matchEnd = match.index + match[0].length;
    const registryContent = match[1].trim();

    logger.debug(`🔍 [parseNewFormatMessage] Found IMAGE_REGISTRY at position ${matchStart}-${matchEnd}`);

    // Add the text segment that precedes IMAGE_REGISTRY
    if (matchStart > currentPosition) {
      const beforeText = content.substring(currentPosition, matchStart).trim();
      if (beforeText) {
        segments.push({
          type: 'text',
          content: beforeText,
          id: `${messageId}_segment_${segmentIndex++}`,
          originalMessageId: messageId,
          segmentIndex: segmentIndex - 1
        });
        logger.debug(`📝 [parseNewFormatMessage] Added text segment before registry: ${beforeText.length} chars`);
      }
    }

    // Parse images in the current IMAGE_REGISTRY
    const imageRegistry = new Map<string, any>();

    if (registryContent) {
      const lines = registryContent.split('\n');
      logger.debug('📊 [parseNewFormatMessage] Processing', lines.length, 'registry lines');
      for (const line of lines) {
        const trimmedLine = line.trim();
        if (trimmedLine) {
          try {
            const imageData = JSON.parse(trimmedLine);
            if (imageData.id) {
              imageRegistry.set(imageData.id, imageData);
              logger.debug('🖼️ [parseNewFormatMessage] Registered image:', imageData.id);
            }
          } catch (error) {
            logger.debug('⚠️ [parseNewFormatMessage] Skipping non-JSON line:', trimmedLine.substring(0, 50));
          }
        }
      }
    }

    // Add an image gallery segment (if any images were found)
    if (imageRegistry.size > 0) {
      segments.push({
        type: 'image-gallery',
        content: '', // image gallery does not need content
        id: `${messageId}_gallery_${segmentIndex++}`,
        originalMessageId: messageId,
        segmentIndex: segmentIndex - 1,
        imageRegistry: imageRegistry
      });
      logger.debug(`🎨 [parseNewFormatMessage] Added gallery segment with ${imageRegistry.size} images`);
    }

    // Update current position
    currentPosition = matchEnd;
  }

  // If no complete IMAGE_REGISTRY was found
  if (!foundAnyRegistry) {
    logger.debug('⚠️ [parseNewFormatMessage] No complete IMAGE_REGISTRY found');

    // Check whether there is an incomplete IMAGE_REGISTRY opening tag
    const hasRegistryStart = content.includes('<IMAGE_REGISTRY>');

    if (hasRegistryStart) {
      logger.debug('🔄 [parseNewFormatMessage] IMAGE_REGISTRY is still streaming');

      const registryStartIndex = content.indexOf('<IMAGE_REGISTRY>');

      // Render the content that precedes IMAGE_REGISTRY
      const beforeRegistry = content.substring(0, registryStartIndex).trim();
      if (beforeRegistry) {
        segments.push({
          type: 'text',
          content: beforeRegistry,
          id: `${messageId}_segment_before_registry`,
          originalMessageId: messageId,
          segmentIndex: segmentIndex++
        });
      }

      // If streaming, render the content that follows the IMAGE_REGISTRY opening tag (if any)
      if (isStreaming) {
        const afterRegistryStart = content.substring(registryStartIndex).trim();
        const contentAfterTag = afterRegistryStart.substring('<IMAGE_REGISTRY>'.length).trim();
        if (contentAfterTag) {
          segments.push({
            type: 'text',
            content: contentAfterTag,
            id: `${messageId}_segment_streaming_after_registry`,
            originalMessageId: messageId,
            segmentIndex: segmentIndex++
          });
        }
      }

      logger.debug('⏳ [parseNewFormatMessage] Waiting for IMAGE_REGISTRY to complete...');
      return segments;
    }

    // No IMAGE_REGISTRY tag at all — render all content as text
    const visibleContent = content.trim();
    if (visibleContent) {
      segments.push({
        type: 'text',
        content: visibleContent,
        id: `${messageId}_segment_${segmentIndex++}`,
        originalMessageId: messageId,
        segmentIndex: segmentIndex - 1
      });
    }
    return segments;
  }

  // Handle the content that follows the last IMAGE_REGISTRY
  if (currentPosition < content.length) {
    const afterLastRegistry = content.substring(currentPosition).trim();
    if (afterLastRegistry) {
      segments.push({
        type: 'text',
        content: afterLastRegistry,
        id: `${messageId}_segment_${segmentIndex++}`,
        originalMessageId: messageId,
        segmentIndex: segmentIndex - 1
      });
      logger.debug(`📄 [parseNewFormatMessage] Added final text segment: ${afterLastRegistry.length} chars`);
    }
  }

  logger.debug('✅ [parseNewFormatMessage] END - Total segments:', segments.length);
  logger.debug('📊 [parseNewFormatMessage] Segment types:', segments.map(s => s.type).join(', '));

  return segments;
};

// 🆕 Image cache manager — uses a Map to store URL → Base64 mappings
const imageCache = new Map<string, string>();

// 🆕 New image gallery component — Google-search-style multi-row layout, fixed height, dynamic width
const ImageGalleryNew: React.FC<{ imageRegistry: Map<string, any> }> = ({ imageRegistry }) => {
  const [loadingStates, setLoadingStates] = useState<Map<string, boolean>>(new Map());
  const [errorStates, setErrorStates] = useState<Map<string, boolean>>(new Map());
  const [cachedUrls, setCachedUrls] = useState<Map<string, string>>(new Map());
  const [imageDimensions, setImageDimensions] = useState<Map<string, { width: number; height: number }>>(new Map());

  const FIXED_HEIGHT = 130; // fixed height
  const imageGalleryMenuActions = ImageGalleryMenuAtom.useChange();

  // Initialize loading states and check cache
  useEffect(() => {
    const initialLoadingStates = new Map<string, boolean>();
    const initialCachedUrls = new Map<string, string>();

    imageRegistry.forEach((imageData, id) => {
      const url = imageData.url;

      // Check whether image is already cached
      if (imageCache.has(url)) {
        // Use cached image
        initialCachedUrls.set(id, imageCache.get(url)!);
        initialLoadingStates.set(id, false);
      } else {
        // Needs to be loaded
        initialLoadingStates.set(id, true);
        // Start pre-loading and caching
        cacheImage(url, id);
      }
    });

    setLoadingStates(initialLoadingStates);
    setCachedUrls(initialCachedUrls);
  }, [imageRegistry]);

  const resolveImageReady = (imageId: string, cachedUrl: string) => {
    setCachedUrls(prev => { const m = new Map(prev); m.set(imageId, cachedUrl); return m; });
    setLoadingStates(prev => { const m = new Map(prev); m.set(imageId, false); return m; });
  };

  // Image caching function — converts a remote image to Base64 and caches it
  const cacheImage = async (url: string, imageId: string) => {
    try {
      // If already in cache, use it directly
      if (imageCache.has(url)) {
        resolveImageReady(imageId, imageCache.get(url)!);
        return;
      }

      // Use fetch to download the image (file:// URLs skip fetch and use <img src> directly)
      if (url.startsWith('file://') || url.startsWith('/')) {
        const directUrl = url.startsWith('/') ? `file://${url}` : url;
        imageCache.set(url, directUrl);
        resolveImageReady(imageId, directUrl);
        return;
      }

      const response = await fetch(url);
      const blob = await response.blob();

      // Convert to Base64
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64data = reader.result as string;

        // Store in global cache
        imageCache.set(url, base64data);
        resolveImageReady(imageId, base64data);
      };

      reader.onerror = () => {
        handleImageError(imageId);
      };

      reader.readAsDataURL(blob);
    } catch (error) {
      logger.error('Failed to cache image:', url, error);
      handleImageError(imageId);
    }
  };

  const handleImageLoad = (imageId: string) => {
    setLoadingStates(prev => {
      const newState = new Map(prev);
      newState.set(imageId, false);
      return newState;
    });
  };

  const handleImageError = (imageId: string) => {
    setLoadingStates(prev => {
      const newState = new Map(prev);
      newState.set(imageId, false);
      return newState;
    });
    setErrorStates(prev => {
      const newState = new Map(prev);
      newState.set(imageId, true);
      return newState;
    });
  };

  // Handle image load completion and retrieve dimensions
  const handleImageLoadWithDimensions = (imageId: string, imgElement: HTMLImageElement) => {
    const naturalWidth = imgElement.naturalWidth;
    const naturalHeight = imgElement.naturalHeight;

    if (naturalWidth && naturalHeight) {
      setImageDimensions(prev => {
        const newDimensions = new Map(prev);
        newDimensions.set(imageId, { width: naturalWidth, height: naturalHeight });
        return newDimensions;
      });
    }

    handleImageLoad(imageId);
  };

  const images = Array.from(imageRegistry.values());

  if (images.length === 0) {
    return null;
  }

  // Click an image to open the full-screen viewer
  const handleImageClick = (clickedIndex: number) => {
    // 🔥 Fix: filter out invalid image data to ensure every element has a url property
    const galleryImages = images
      .filter((imageData) => imageData && imageData.url) // filter out invalid data
      .map((imageData) => ({
        id: imageData.id || `unknown-${Date.now()}`,
        url: cachedUrls.get(imageData.id) || imageData.url,
        alt: imageData.alt || `Image ${imageData.id || 'unknown'}`
      }));

    if (galleryImages.length === 0) {
      logger.warn('🚨 [ImageGallery] No valid images found for viewer');
      return;
    }

    window.dispatchEvent(new CustomEvent('imageViewer:open', {
      detail: {
        images: galleryImages,
        initialIndex: Math.min(clickedIndex, galleryImages.length - 1) // ensure the index is valid
      }
    }));
  };

  // Prepare complete gallery data for the context menu
  const galleryImages = images
    .filter((imageData) => imageData && imageData.url) // 🔥 Fix: filter out invalid data
    .map((imageData) => ({
      id: imageData.id || `unknown-${Date.now()}`,
      url: cachedUrls.get(imageData.id) || imageData.url,
      alt: imageData.alt || `Image ${imageData.id || 'unknown'}`
    }));

  return (
    <div className="image-gallery-new">
      {/* New Google-search-results-style image grid container */}
      <div className="gallery-grid-container">
        {images.map((imageData, index) => {
          // Validate image data
          if (!imageData || !imageData.url) {
            logger.warn('🚨 [ImageGalleryNew] Skipping invalid image data at index:', index, imageData);
            return null;
          }

          const isLoading = loadingStates.get(imageData.id) ?? true;
          const hasError = errorStates.get(imageData.id) ?? false;
          const cachedUrl = cachedUrls.get(imageData.id) || imageData.url;

          // Calculate image width based on fixed height and the image's aspect ratio
          const dimensions = imageDimensions.get(imageData.id);
          let calculatedWidth = 130; // default width to avoid 0
          if (dimensions && dimensions.height > 0) {
            const aspectRatio = dimensions.width / dimensions.height;
            calculatedWidth = Math.round(FIXED_HEIGHT * aspectRatio);
          }

          const isLocalFile = cachedUrl.startsWith('file://') || cachedUrl.startsWith('/');

          return (
            <div
              key={imageData.id || `fallback-${index}`}
              className="gallery-grid-item"
              style={{
                width: `${calculatedWidth}px`,
                maxWidth: '100%', // 🔥 dynamically cap max-width at 100% of the container to prevent oversized images from overflowing
                backgroundImage: !isLocalFile && !isLoading && !hasError ? `url(${cachedUrl})` : 'none',
                backgroundColor: '#D9D9D9'
              }}
              onClick={!isLoading && !hasError ? () => handleImageClick(index) : undefined}
              onContextMenu={!isLoading && !hasError ? (e) => {
                e.preventDefault();
                e.stopPropagation();
                // Trigger the ImageGallery context-menu event with full gallery info
                const image = { url: cachedUrl, alt: imageData.alt, index };
                imageGalleryMenuActions.open(e, image, galleryImages, index);
              } : undefined}
              title={!isLoading && !hasError ? "Click to view full size | Right-click for more options" : undefined}
            >
              {/* Loading state — displayed in the center of the image container */}
              {isLoading && (
                <div className="image-loading-overlay">
                  <div className="loading-spinner">
                    <div className="spinner-circle"></div>
                  </div>
                </div>
              )}

              {/* Error state */}
              {hasError && (
                <div className="image-error-placeholder">
                  <span className="error-icon">⚠️</span>
                  <span className="error-text">Image failed to load</span>
                </div>
              )}

              {/* Hidden img element used to trigger onLoad/onError events and retrieve image dimensions */}
              {!hasError && (
                <img
                  src={cachedUrl}
                  alt={imageData.alt || `Image ${imageData.id}`}
                  onLoad={(e) => handleImageLoadWithDimensions(imageData.id, e.currentTarget)}
                  onError={() => handleImageError(imageData.id)}
                  style={isLocalFile
                    ? { width: '100%', height: '100%', objectFit: 'cover' }
                    : { display: 'none' }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const Message: React.FC<MessageProps> = ({
  message,
  isStreaming = false,
  onContentChange,
  cachedFilePaths = [],
  presentedFiles = [],
  chatId,
  canEditUserMessage = false,
  onEditUserMessage
}) => {
  const [isCopied, setIsCopied] = useState(false);

  const getMessageClass = () => {
    switch (message.role) {
      case 'user':
        return 'message user-message';
      case 'assistant':
        // If tool_calls are present, add the has-tool-calls class name
        return message.tool_calls && message.tool_calls.length > 0
          ? 'message assistant-message has-tool-calls'
          : 'message assistant-message';
      case 'system':
        return 'message system-message';
      case 'tool':
        return message.name?.startsWith('tool')
          ? 'message tool-system-message'
          : 'message tool-message';
      default:
        return 'message';
    }
  };

  const getMessageContainerClass = () => {
    switch (message.role) {
      case 'user':
        return 'message-container user-message-container';
      case 'assistant':
        return message.tool_calls && message.tool_calls.length > 0
          ? 'message-container assistant-message-container has-tool-calls'
          : 'message-container assistant-message-container';
      case 'system':
        return 'message-container system-message-container';
      case 'tool':
        return message.name?.startsWith('tool')
          ? 'message-container tool-system-message-container'
          : 'message-container tool-message-container';
      default:
        return 'message-container';
    }
  };

  // 🔥 Tool calls are rendered centrally by ChatContainer; Message no longer renders them
  const renderToolCalls = () => {
    return null;
  };

  const generatedFileCardItems = React.useMemo<GeneratedFileCardItem[]>(() => {
    return cachedFilePaths.map((fileInfo) => ({
      filePath: fileInfo.path,
      exists: fileInfo.exists,
    }));
  }, [cachedFilePaths]);

  const presentedGeneratedFileCardItems = React.useMemo<GeneratedFileCardItem[]>(() => {
    return normalizePresentedFilesToGeneratedFileItems(presentedFiles);
  }, [presentedFiles]);

  // 🔥 Open OverlayImageViewer (via a global custom event)
  const handleOpenImageViewer = (imageParts: ReturnType<typeof MessageHelper.getImages>, clickedIndex: number) => {
    const images = imageParts.map((part, idx) => ({
      id: `msg-${message.id || 'unknown'}-img-${idx}`,
      url: part.image_url.url,
      alt: part.metadata.fileName || `Image ${idx + 1}`,
    }));
    window.dispatchEvent(
      new CustomEvent('imageViewer:open', { detail: { images, initialIndex: clickedIndex } }),
    );
  };

  // 🔥 Open OverlayFileViewer (via a global custom event)
  const handleOpenFileViewer = (file: { fileName: string; filePath: string; mimeType?: string; fileSize?: number }) => {
    window.dispatchEvent(
      new CustomEvent('fileViewer:open', {
        detail: {
          file: {
            name: file.fileName,
            url: file.filePath,
            mimeType: file.mimeType,
            size: file.fileSize,
          },
        },
      }),
    );
  };

  // Unified attachment rendering function
  const renderAttachmentsContent = () => {
    if (!Array.isArray(message.content)) return null;

    const imageParts = MessageHelper.getImages(message);
    const fileParts = MessageHelper.getFiles(message);
    const officeParts = MessageHelper.getOffice(message);
    const othersParts = MessageHelper.getOthers(message);
    const totalAttachments = imageParts.length + fileParts.length + officeParts.length + othersParts.length;

    if (totalAttachments === 0) return null;

    const isSingleAttachment = totalAttachments === 1;

    return (
      <div className="message-attachments">
        <div className={`attachments-grid ${isSingleAttachment ? 'single-attachment' : 'multiple-attachments'}`}>
          {/* Render image attachments — 🔥 click to open OverlayImageViewer */}
          {imageParts.map((imagePart, index) => (
            <div
              key={`image-${index}`}
              className="attachment-card image-attachment clickable"
              onClick={() => handleOpenImageViewer(imageParts, index)}
              style={{ cursor: 'pointer' }}
              title={`Click to preview: ${imagePart.metadata.fileName || `Image ${index + 1}`}`}
            >
              <div className="attachment-preview image-preview-full">
                <img
                  src={imagePart.image_url.url}
                  alt={imagePart.metadata.fileName || `Image ${index + 1}`}
                  className="attachment-image"
                  title={imagePart.metadata.fileName || `Image ${index + 1}`}
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
              </div>
            </div>
          ))}

          {/* Render file attachments — 🔥 click to open OverlayFileViewer */}
          {fileParts.map((filePart, index) => (
            <div
              key={`file-${index}`}
              className="attachment-card file-attachment clickable"
              onClick={() => handleOpenFileViewer({
                fileName: filePart.file.fileName,
                filePath: filePart.file.filePath,
                mimeType: filePart.file.mimeType,
                fileSize: filePart.metadata.fileSize,
              })}
              style={{ cursor: 'pointer' }}
              title={`Click to preview: ${filePart.file.fileName}`}
            >
              <div className="attachment-preview">
                <div className="file-icon">
                  <FileTypeIcon fileName={filePart.file.fileName} size={24} />
                </div>
              </div>
              <div className="attachment-info">
                <div className="attachment-name" title={filePart.file.fileName}>
                  {filePart.file.fileName}
                </div>
              </div>
            </div>
          ))}

          {/* Render Office attachments — 🔥 click to open OverlayFileViewer */}
          {officeParts.map((officePart, index) => (
            <div
              key={`office-${index}`}
              className="attachment-card file-attachment clickable"
              onClick={() => handleOpenFileViewer({
                fileName: officePart.file.fileName,
                filePath: officePart.file.filePath,
                mimeType: officePart.file.mimeType,
                fileSize: officePart.metadata.fileSize,
              })}
              style={{ cursor: 'pointer' }}
              title={`Click to preview: ${officePart.file.fileName}`}
            >
              <div className="attachment-preview">
                <div className="file-icon">
                  <FileTypeIcon fileName={officePart.file.fileName} size={24} />
                </div>
              </div>
              <div className="attachment-info">
                <div className="attachment-name" title={officePart.file.fileName}>
                  {officePart.file.fileName}
                </div>
              </div>
            </div>
          ))}

          {/* Render other file attachments — 🔥 click to open OverlayFileViewer */}
          {othersParts.map((othersPart, index) => (
            <div
              key={`others-${index}`}
              className="attachment-card file-attachment clickable"
              onClick={() => handleOpenFileViewer({
                fileName: othersPart.file.fileName,
                filePath: othersPart.file.filePath,
                mimeType: othersPart.file.mimeType,
                fileSize: othersPart.metadata.fileSize,
              })}
              style={{ cursor: 'pointer' }}
              title={`Click to preview: ${othersPart.file.fileName}`}
            >
              <div className="attachment-preview">
                <div className="file-icon">
                  <FileTypeIcon fileName={othersPart.file.fileName} size={24} />
                </div>
              </div>
              <div className="attachment-info">
                <div className="attachment-name" title={othersPart.file.fileName}>
                  {othersPart.file.fileName}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };


  // Extract text content — handles the unified content format and malformed JSON formats
  const extractTextContent = (content: any): string => {
    // If content is a string, return it directly
    if (typeof content === 'string') {
      return content;
    }

    // 🔥 Fix: prioritize processing the JSON content array format [{type: "text", text: "..."}]
    if (Array.isArray(content) && content.length > 0) {
      // Extract all parts of type "text"
      const textParts = content
        .filter(part => part && typeof part === 'object' && part.type === 'text')
        .map(part => String(part.text || ''))
        .join('');

      if (textParts) {
        return textParts;
      }

      // If no text-type parts were found, try using MessageHelper
      if (typeof content[0] === 'object' && 'type' in content[0]) {
        return MessageHelper.getText(message);
      }
    }

    // If content is another kind of object, avoid displaying raw JSON
    if (content && typeof content === 'object') {
      // If it is an empty object or a meaningless object, return an empty string
      return '';
    }

    return String(content || '');
  };

  // Function to copy the message content
  const handleCopyMessage = async () => {
    try {
      const textContent = extractTextContent(message.content);
      await navigator.clipboard.writeText(textContent);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 500); // reset after 0.5 seconds
    } catch (error) {
    }
  };

  const scheduleIds = React.useMemo(() => {
    const textContent = extractTextContent(message.content);
    return Array.from(new Set(textContent.match(SCHEDULE_JOB_ID_PATTERN) || []));
  }, [message.content]);

  const renderGeneratedArtifacts = () => {
    const hasPresentedFiles = presentedFiles.length > 0;
    const hasGeneratedFiles = generatedFileCardItems.length > 0;
    const hasScheduleCards = scheduleIds.length > 0;

    if (!hasPresentedFiles && !hasGeneratedFiles && !hasScheduleCards) {
      return null;
    }

    return (
      <>
        {hasPresentedFiles ? (
          <GeneratedFileCards items={presentedGeneratedFileCardItems} />
        ) : (
          <GeneratedFileCards items={generatedFileCardItems} />
        )}
        <GeneratedScheduleCards scheduleIds={scheduleIds} />
      </>
    );
  };

  // 🆕 New: new-format image rendering function
  const renderNewFormatMessage = (message: MessageType, content: string, isContentStreaming: boolean) => {
    logger.debug('🎨 [renderNewFormatMessage] START - messageId:', message.id, 'isContentStreaming:', isContentStreaming);
    logger.debug('📏 [renderNewFormatMessage] Content length:', content.length);

    const segments = parseNewFormatMessage(content, message.id || 'unknown', isContentStreaming);

    logger.debug('🎨 [renderNewFormatMessage] Got', segments.length, 'segments to render');

    return (
      <div className="segmented-message new-format">
        {segments.map((segment, index) => (
          <div key={segment.id} className={`segment segment-${segment.type} ${index === segments.length - 1 && isContentStreaming ? 'streaming' : ''}`}>
            {segment.type === 'text' ? (
              <div className={getMessageClass()}>
                <div className={`message-content markdown-body ${index === segments.length - 1 && isContentStreaming ? 'streaming' : ''}`}>
                  <div className="flex w-full min-w-0 max-w-full items-start">
                    <div className="min-w-0 max-w-full flex-1">
                      {/* 🔥 Fix: always use StreamingV2Message to render text segments, ensuring consistent styles during and after streaming */}
                      {(() => {
                        const segmentMessage: MessageType = {
                          ...message,
                          content: [{ type: 'text' as const, text: segment.content }]
                        };
                        const isLastAndStreaming = index === segments.length - 1 && isContentStreaming;

                        return (
                          <StreamingV2Message
                            message={segmentMessage}
                            isStreaming={isLastAndStreaming}
                            enableMetricsDisplay={false}
                            onStreamingComplete={() => {
                            }}
                            onHeightChange={(newHeight) => {
                              if (onContentChange) {
                                onContentChange(segment.content, true);
                              }
                            }}
                          />
                        );
                      })()}
                    </div>
                  </div>
                </div>
              </div>
            ) : segment.type === 'image-gallery' ? (
              // 🆕 Image gallery segment — uses ImageGalleryNew component (Google-search multi-row style)
              <div className={getMessageClass()}>
                <div className="message-content">
                  <div className="flex w-full min-w-0 max-w-full items-start">
                    <div className="min-w-0 max-w-full flex-1">
                      <ImageGalleryNew imageRegistry={segment.imageRegistry!} />
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        ))}
        {/* 🔥 Message metadata: file attachments + action buttons, at the same level as segments */}
        {!isContentStreaming && (!(message.role === 'assistant' && message.tool_calls && message.tool_calls.length > 0) || presentedFiles.length > 0) && (
          <div className="message-meta">
            {renderGeneratedArtifacts()}
            <div className="message-actions">
              <button
                className="message-action-btn copy-btn"
                onClick={handleCopyMessage}
                title="Copy"
                aria-label="Copy"
              >
                <svg className="action-icon" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                </svg>
              </button>
            </div>
          </div>
        )}
        {/* 🔥 Fix: also render tool_calls in new-format messages */}
        {renderToolCalls()}
      </div>
    );
  };

  // 🔥 Debug: log message rendering
  if (message.id?.startsWith('say-hi')) {
    logger.debug('🎉 [Message] Rendering say-hi message:', {
      id: message.id,
      role: message.role,
      contentLength: Array.isArray(message.content)
        ? (message.content[0] as any)?.text?.length
        : 0
    });
  }

  // Do not render tool messages or system messages
  if (message.role === 'tool' || message.role === 'system') {
    return null;
  }

  // 🔥 Refactor: remove thinking-message rendering logic
  // All assistant messages are now rendered directly; there is no longer a "thinking" type
  if (message.role === 'thinking' as any) {
    // Keep empty branch for backward compatibility, but execution should never reach here
    logger.warn('[Message] Unexpected thinking role message - this should not happen after refactoring');
    return null;
  }

  // Optimize markdown rendering content during streaming
  const optimizeContentForMarkdown = (content: string, isStreaming: boolean): string => {
    if (!content) return content;

    // Clean up malformed list formats that may cause rendering issues
    let cleanedContent = content;

    // Fix numbered lists that may have odd spacing
    cleanedContent = cleanedContent.replace(/^(\d+)\.\s*$/gm, '$1. ');

    // Ensure correct line breaks for lists
    cleanedContent = cleanedContent.replace(/(\d+\.\s[^\n]*)\n(?=\d+\.)/g, '$1\n\n');

    // If streaming and the content does not end with a complete markdown element,
    // ensure correct formatting of partial content
    if (isStreaming && message.role === 'assistant') {
      // Handle potentially incomplete partial code blocks
      const codeBlockMatches = cleanedContent.match(/```(\w+)?\n/g);
      const codeBlockClosures = cleanedContent.match(/\n```/g);

      if (codeBlockMatches && (!codeBlockClosures || codeBlockMatches.length > codeBlockClosures.length)) {
        // There is an unclosed code block — do not add extra formatting for now
        return cleanedContent;
      }

      // Handle potentially incomplete inline code
      const inlineCodeMatches = cleanedContent.match(/`[^`]*$/);
      if (inlineCodeMatches) {
        // There may be incomplete inline code
        return cleanedContent;
      }

      // Handle partial markdown syntax
      const partialMarkdown = cleanedContent.match(/(\*{1,2}|_{1,2}|#{1,6}|\[.*?\]|\()$/);
      if (partialMarkdown) {
        // Content ends with partial markdown syntax — render as-is
        return cleanedContent;
      }
    }

    return cleanedContent;
  };

  // 🔥 Process message content: remove <FINAL_SUMMARY> markers (used to identify the final reply; should not be shown to users)
  let rawContent = Array.isArray(message.content) ? extractTextContent(message.content) : String(message.content);
  // Remove the leading <FINAL_SUMMARY> marker and any trailing whitespace
  rawContent = rawContent.replace(/^\s*<FINAL_SUMMARY>\s*/, '');

  const processedContent = optimizeContentForMarkdown(rawContent, isStreaming);

  // 🆕 Say-Hi action items: parse clickable prompts from say-hi messages
  const isSayHiMessage = !!message.id?.startsWith('say-hi-');
  // Priority 1: PM Agent greeting + hardcoded cards (<!-- PM_AGENT_SAY_HI_CARDS --> delimiter)
  const pmAgentSayHiResult = isSayHiMessage ? parsePmAgentSayHiMessage(processedContent) : null;
  // Priority 2: PM Project Agent card format (<!-- PM_SAY_HI_CARDS --> delimiter)
  const pmSayHiResult = (isSayHiMessage && !pmAgentSayHiResult) ? parsePmSayHiCards(processedContent) : null;
  // Priority 3: legacy action-item chips
  const { markdownBody: sayHiBody, actionItemGroups: sayHiGroups } = (isSayHiMessage && !pmAgentSayHiResult && !pmSayHiResult)
    ? parseSayHiContent(processedContent)
    : {
      markdownBody: pmAgentSayHiResult?.markdownBody ?? pmSayHiResult?.markdownBody ?? processedContent,
      actionItemGroups: [] as import('./SayHiActionItems').ActionItemGroup[],
    };
  // Use the stripped body (without action items/cards) for rendering markdown
  const displayContent = isSayHiMessage
    ? (pmAgentSayHiResult?.markdownBody ?? pmSayHiResult?.markdownBody ?? sayHiBody)
    : processedContent;

  // 🆕 New: if this is an assistant message that contains new-format images, use segmented rendering
  if (message.role === 'assistant' && hasNewImageFormat(displayContent)) {
    return renderNewFormatMessage(message, displayContent, isStreaming);
  }

  return (
    <div className={getMessageContainerClass()}>
      <div className={getMessageClass()}>
        <div className={`message-content markdown-body ${isStreaming ? 'streaming' : ''}`}>
          {message.role === 'assistant' ? (
            // 🔥 Fix: always use StreamingV2Message to render assistant messages, ensuring consistent styles during and after streaming
            (() => {
              const streamingMessage: MessageType = {
                ...message,
                content: [{ type: 'text' as const, text: displayContent }]
              };

              return (
                <div className="assistant-message-flow min-w-0 w-full max-w-full">
                  <StreamingV2Message
                    message={streamingMessage}
                    isStreaming={isStreaming}
                    enableMetricsDisplay={false}
                    onStreamingComplete={() => {
                    }}
                    onHeightChange={(newHeight) => {
                      if (onContentChange) {
                        onContentChange(displayContent, true);
                      }
                    }}
                  />
                  {/* 🆕 Render say-hi action items: PM Agent cards > PM Project cards > legacy chips */}
                  {isSayHiMessage && pmAgentSayHiResult && (
                    <PmAgentSayHiCards />
                  )}
                  {isSayHiMessage && !pmAgentSayHiResult && pmSayHiResult && pmSayHiResult.cards.length > 0 && (
                    <PmProjectSayHiCards cards={pmSayHiResult.cards} chatId={chatId} />
                  )}
                  {isSayHiMessage && !pmAgentSayHiResult && !pmSayHiResult && sayHiGroups.length > 0 && (
                    <SayHiActionItems groups={sayHiGroups} />
                  )}
                </div>
              );
            })()
          ) : (
            // 🔥 Fix: also use StreamingV2Message for user messages to keep markdown styles consistent
            (() => {
              const userMsg: MessageType = {
                ...message,
                content: [{ type: 'text' as const, text: processedContent }]
              };
              return (
                <>
                  <StreamingV2Message
                    message={userMsg}
                    isStreaming={false}
                    enableMetricsDisplay={false}
                  />
                  {/* Display attachment content — unified image and file attachment display */}
                  {renderAttachmentsContent()}
                </>
              );
            })()
          )}
        </div>
        {renderToolCalls()}
      </div>
      {message.role === 'user' && (
        <div className="message-metadata user-message-metadata">
          <div className="message-actions">
            {canEditUserMessage && onEditUserMessage && (
              <button
                className="message-action-btn"
                onClick={() => onEditUserMessage(message)}
                title="Edit message"
                aria-label="Edit message"
              >
                <svg
                  className="action-icon"
                  width="16"
                  height="16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 20h9"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4 12.5-12.5z"
                  />
                </svg>
              </button>
            )}
            <button
              className="message-action-btn copy-btn"
              onClick={handleCopyMessage}
              title={isCopied ? "Copied" : "Copy"}
              aria-label={isCopied ? "Copied" : "Copy"}
            >
              {isCopied ? (
                <svg className="action-icon" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg className="action-icon" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                </svg>
              )}
            </button>
          </div>
        </div>
      )}
      {message.role === 'assistant' && !isStreaming && (!(message.tool_calls && message.tool_calls.length > 0) || presentedFiles.length > 0) && (
        <>
          <div className="message-metadata assistant-message-metadata">
            {renderGeneratedArtifacts()}
            <div className="message-actions">
              <button
                className="message-action-btn copy-btn"
                onClick={handleCopyMessage}
                title={isCopied ? "Copied" : "Copy"}
                aria-label={isCopied ? "Copied" : "Copy"}
              >
                {isCopied ? (
                  <svg className="action-icon" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <svg className="action-icon" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </>
      )}

    </div>
  );
};

export default memo(Message);