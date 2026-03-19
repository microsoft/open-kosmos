import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { MoreHorizontal, FolderOpen, Folder, Eye, Download } from 'lucide-react';
import FileTypeIcon from '../ui/FileTypeIcon';
import MermaidDiagram from './MermaidDiagram';
import { Message as MessageType, MessageHelper } from '../../types/chatTypes';
import { StreamingV2Message } from '../streaming/StreamingV2Message';
import { useToast } from '../ui/ToastProvider';
import '../../styles/Message.css';
import '../../styles/markdown-render.css';
import { PresentedFilesCard, PresentedFile } from './PresentedFilesCard';

// 🔥 Shared Markdown component configuration - fix inline code rendering issue
const sharedMarkdownComponents = {
  // 🔥 Inline code: only handle simple inline code (code not inside pre)
  code(props: any) {
    const { children } = props;
    return (
      <code className="inline-code">
        {children}
      </code>
    );
  },
  // 🔥 Code block: pre wraps code, handle code block rendering here
  pre(props: any) {
    const { children } = props;
    
    // Extract code element info from children
    const codeChild = React.Children.toArray(children).find(
      (child: any) => child?.type === 'code' || child?.props?.node?.tagName === 'code'
    ) as React.ReactElement | undefined;
    
    if (codeChild && codeChild.props) {
      const { className, children: codeContent } = codeChild.props;
      const match = /language-(\w+)/.exec(className || '');
      const language = match ? match[1] : 'text';
      const content = String(codeContent).replace(/\n$/, '');

      if (language === 'mermaid') {
        return <MermaidDiagram definition={content} />;
      }

      return (
        <div className="code-block-wrapper">
          <SyntaxHighlighter
            PreTag="div"
            language={language}
            style={oneDark}
            customStyle={{
              margin: 0,
              borderRadius: '0.375rem',
              fontSize: '0.875rem',
              display: 'block',
              minWidth: 'fit-content',
            }}
            wrapLongLines={false}
            codeTagProps={{
              style: {
                whiteSpace: 'pre',
                wordWrap: 'normal',
                overflowWrap: 'normal',
              },
            }}
          >
            {content}
          </SyntaxHighlighter>
        </div>
      );
    }

    return <div className="pre-wrapper">{children}</div>;
  },
  h1(props: any) {
    return <h1 {...props} />;
  },
  h2(props: any) {
    return <h2 {...props} />;
  },
  h3(props: any) {
    return <h3 {...props} />;
  },
  p(props: any) {
    return <p {...props} />;
  },
  ul(props: any) {
    return <ul {...props} />;
  },
  ol(props: any) {
    return <ol {...props} />;
  },
  li(props: any) {
    return <li {...props} />;
  },
  blockquote(props: any) {
    return <blockquote {...props} />;
  },
  table(props: any) {
    return (
      <div className="table-wrapper">
        <table {...props} />
      </div>
    );
  },
  thead(props: any) {
    return <thead {...props} />;
  },
  tbody(props: any) {
    return <tbody {...props} />;
  },
  tr(props: any) {
    return <tr {...props} />;
  },
  th(props: any) {
    return <th {...props} />;
  },
  td(props: any) {
    return <td {...props} />;
  },
  a(props: any) {
    const { href, children, ...rest } = props;
    // Detect local file path (starts with / but not //, or starts with drive letter)
    const isLocalPath = href && (/^\/[^/]/.test(href) || /^[A-Za-z]:[\\/]/.test(href));
    if (isLocalPath) {
      return (
        <a
          {...rest}
          href="#"
          className="text-blue-600 hover:text-blue-800 underline cursor-pointer"
          onClick={(e: React.MouseEvent) => {
            e.preventDefault();
            const decodedPath = decodeURIComponent(href);
            window.electronAPI?.workspace?.openPath(decodedPath);
          }}
        >
          {children}
        </a>
      );
    }
    return <a {...props} className="text-blue-600 hover:text-blue-800 underline" target="_blank" rel="noopener noreferrer" />;
  },
  strong(props: any) {
    return <strong {...props} className="font-bold" />;
  },
  em(props: any) {
    return <em {...props} className="italic" />;
  },
};

// Message segment interface definition
interface MessageSegment {
  type: 'text' | 'image' | 'image-placeholder' | 'image-gallery';
  content: string;
  id: string;
  originalMessageId: string;
  segmentIndex: number;
  imageRegistry?: Map<string, any>; // Used for image-gallery type to store image registry
}

interface MessageProps {
  message: MessageType;
  allMessages?: MessageType[]; // 🔥 Retained for looking up tool result display
  isStreaming?: boolean; // Indicates whether the message is being streamed
  onContentChange?: (newContent: string, heightChanged: boolean) => void; // Scroll management callback
  onSystemPromptClick?: () => void; // Callback when clicking system prompt message
  onApprovalResponse?: (approved: boolean) => void; // 🔥 New: approval request callback
  workspacePath?: string; // 🆕 New: workspace path, used for joining relative file paths
  chatStatus?: { // 🆕 New: chat status, used to control loading message inside thinking section
    chatId: string;
    chatStatus: 'idle' | 'sending_response' | 'compressing_context' | 'compressed_context' | 'received_response';
    agentName?: string;
  } | null;
  cachedFilePaths?: Array<{ path: string; exists: boolean }>; // Cached file paths from backend for rendering
  presentedFiles?: PresentedFile[]; // Files from present tool to display
}

// Precomputed constants (module level)
const OPEN_TAG = '<IMAGE_DISPLAY>';
const CLOSE_TAG = '</IMAGE_DISPLAY>';
const OPEN_TAG_LEN = OPEN_TAG.length;
const CLOSE_TAG_LEN = CLOSE_TAG.length;

// Precomputed opening tag prefix array
const OPEN_TAG_PREFIXES = [
  '<', '<I', '<IM', '<IMA', '<IMAG', '<IMAGE', '<IMAGE_', 
  '<IMAGE_D', '<IMAGE_DI', '<IMAGE_DIS', '<IMAGE_DISP', 
  '<IMAGE_DISPL', '<IMAGE_DISPLA', '<IMAGE_DISPLAY'
];

// Precomputed closing tag prefix array
const CLOSE_TAG_PREFIXES = [
  '</', '</I', '</IM', '</IMA', '</IMAG', '</IMAGE', 
  '</IMAGE_', '</IMAGE_D', '</IMAGE_DI', '</IMAGE_DIS', 
  '</IMAGE_DISP', '</IMAGE_DISPL', '</IMAGE_DISPLA'
];

// Check if content contains image tags (legacy format)
const hasImageContent = (content: string): boolean => {
  return content.includes('<IMAGE_DISPLAY>');
};

// 🆕 Check if content contains new format images (check for IMAGE_REGISTRY tag)
const hasNewImageFormat = (content: string): boolean => {
  const trimmedContent = content.trim();
  
  // Case 1: Message contains complete <IMAGE_REGISTRY> tag pair (opening and closing tags)
  const hasCompleteRegistry = /<IMAGE_REGISTRY>\s*([\s\S]*?)\s*<\/IMAGE_REGISTRY>/.test(trimmedContent);
  
  if (hasCompleteRegistry) {
    return true;
  }
  
  // Case 2: Incomplete tag during streaming
  // 🔥 Fix: Only consider it a real image tag when <IMAGE_REGISTRY> is immediately followed by a newline
  // This excludes cases where <IMAGE_REGISTRY> is mentioned in plain text
  const hasRegistryStartWithNewline = /<IMAGE_REGISTRY>\s*\n/.test(trimmedContent);
  
  if (hasRegistryStartWithNewline) {
    return true;
  }
  
  // Case 3: Message equals an IMAGE_REGISTRY prefix (for incomplete state during streaming)
  // Only determine as new format when the entire message is this prefix
  const REGISTRY_PREFIXES = [
    '<', '<I', '<IM', '<IMA', '<IMAG', '<IMAGE', '<IMAGE_',
    '<IMAGE_R', '<IMAGE_RE', '<IMAGE_REG', '<IMAGE_REGI',
    '<IMAGE_REGIS', '<IMAGE_REGIST', '<IMAGE_REGISTR'
  ];
  
  // Note: using === for equality check here, not startsWith
  return REGISTRY_PREFIXES.includes(trimmedContent);
};

// Check if there are incomplete image tags
const hasIncompleteImageTag = (content: string): boolean => {
  // TODO: May need optimization, currently checked on every render update, affecting performance
  
  // Use precomputed quick end check
  const contentEnd = content.slice(-OPEN_TAG_LEN); // Only check the end portion of sufficient length
  
  // Check if the end has an incomplete opening tag (using precomputed prefix array)
  for (let i = 0; i < OPEN_TAG_PREFIXES.length - 1; i++) { // Exclude complete tag
    if (contentEnd.endsWith(OPEN_TAG_PREFIXES[i])) {
      return true;
    }
  }
  
  // Check if the end has an incomplete closing tag (using precomputed prefix array)
  for (let i = 0; i < CLOSE_TAG_PREFIXES.length; i++) {
    if (contentEnd.endsWith(CLOSE_TAG_PREFIXES[i])) {
      return true;
    }
  }
  
  // Check if there are unclosed complete opening tags (using optimized counting method)
  const { openCount, closeCount } = countTagsOptimized(content);
  
  if (openCount > closeCount) {
    return true;
  }
  
  return false;
};

// Fast string matching function
const fastIndexOf = (content: string, target: string, startPos: number = 0): number => {
  return content.indexOf(target, startPos);
};

// Check if the last image tag is unclosed
const hasUnclosedImageAtEnd = (content: string): boolean => {
  const lastOpenIndex = content.lastIndexOf('<IMAGE_DISPLAY>');
  const lastCloseIndex = content.lastIndexOf('</IMAGE_DISPLAY>');
  
  // Last opening tag is after the last closing tag = unclosed
  return lastOpenIndex > lastCloseIndex;
};

// Fast end check function
const quickEndCheck = (content: string): number => {
  const endPart = content.slice(-OPEN_TAG_LEN); // Only check the end portion of sufficient length
  
  // Use precomputed prefix array
  for (let i = 0; i < OPEN_TAG_PREFIXES.length; i++) {
    if (endPart.endsWith(OPEN_TAG_PREFIXES[i])) {
      return content.length - OPEN_TAG_PREFIXES[i].length;
    }
  }
  
  for (let i = 0; i < CLOSE_TAG_PREFIXES.length; i++) {
    if (endPart.endsWith(CLOSE_TAG_PREFIXES[i])) {
      return content.length - CLOSE_TAG_PREFIXES[i].length;
    }
  }
  
  return content.length; // No incomplete tags
};

// Count opening and closing tags in a single traversal
const countTagsOptimized = (content: string): { openCount: number, closeCount: number, lastUnclosedPos?: number } => {
  let openCount = 0;
  let closeCount = 0;
  let lastUnclosedPos: number | undefined;
  let position = 0;
  
  while (position < content.length) {
    const openPos = fastIndexOf(content, OPEN_TAG, position);
    const closePos = fastIndexOf(content, CLOSE_TAG, position);
    
    if (openPos === -1 && closePos === -1) break;
    
    if (openPos !== -1 && (closePos === -1 || openPos < closePos)) {
      openCount++;
      if (openCount > closeCount) {
        lastUnclosedPos = openPos;
      }
      position = openPos + OPEN_TAG_LEN;
    } else if (closePos !== -1) {
      closeCount++;
      position = closePos + CLOSE_TAG_LEN;
    }
  }
  
  return { openCount, closeCount, lastUnclosedPos };
};

// Parse message content into segments
const parseMessageIntoSegments = (content: string, messageId: string, isStreaming: boolean): MessageSegment[] => {
  const segments: MessageSegment[] = [];
  let currentPosition = 0;
  let segmentIndex = 0;
  
  // Quick pre-check: if content doesn't contain '<' character, return text segment directly
  if (!content.includes('<')) {
    if (content.trim()) {
      segments.push({
        type: 'text',
        content: content.trim(),
        id: `${messageId}_segment_${segmentIndex}`,
        originalMessageId: messageId,
        segmentIndex: 0
      });
    }
    return segments;
  }
  
  // If streaming and has incomplete image tags, process complete part first
  
  if (isStreaming && hasIncompleteImageTag(content)) {
    
    // Use optimized end check
    let completeContentEnd = quickEndCheck(content);
    
    // Use optimized tag counting
    const { openCount, closeCount, lastUnclosedPos } = countTagsOptimized(content);
    
    if (openCount > closeCount && lastUnclosedPos !== undefined) {
      completeContentEnd = Math.min(completeContentEnd, lastUnclosedPos);
    }
    
    // Extract complete part and parse normally
    const completePart = content.substring(0, completeContentEnd);
    
    const completeSegments = parseCompleteContent(completePart, messageId, 0);
    
    // 🆕 Check if placeholder needs to be added
    if (isStreaming && hasUnclosedImageAtEnd(content)) {
      const lastOpenIndex = content.lastIndexOf('<IMAGE_DISPLAY>');
      
      // Calculate end position of the last complete segment
      let lastCompleteEnd = 0;
      if (completeSegments.length > 0) {
        // Estimate end position of the last segment in original text
        lastCompleteEnd = completePart.length;
      }
      
      // If unclosed tag is after complete content, add placeholder
      if (lastOpenIndex >= lastCompleteEnd) {
        completeSegments.push({
          type: 'image-placeholder',
          content: '',
          id: `${messageId}_placeholder_${completeSegments.length}`,
          originalMessageId: messageId,
          segmentIndex: completeSegments.length
        });
        
      }
    }
    
    return completeSegments;
  }
  
  // Non-streaming or no incomplete tags, parse normally
  return parseCompleteContent(content, messageId, 0);
};

// Parse complete content (legacy IMAGE_DISPLAY format - deprecated, kept for backward compatibility)
const parseCompleteContent = (content: string, messageId: string, startIndex: number): MessageSegment[] => {
  const segments: MessageSegment[] = [];
  let currentPosition = 0;
  let segmentIndex = startIndex;
  
  // Use regex to find all image tags
  const imageRegex = /<IMAGE_DISPLAY\s*>([\s\S]*?)<\/IMAGE_DISPLAY>/gi;
  let match;
  
  while ((match = imageRegex.exec(content)) !== null) {
    // Add text segment before image
    if (match.index > currentPosition) {
      const textContent = content.substring(currentPosition, match.index).trim();
      if (textContent) {
        segments.push({
          type: 'text',
          content: textContent,
          id: `${messageId}_segment_${segmentIndex++}`,
          originalMessageId: messageId,
          segmentIndex: segmentIndex - 1
        });
      }
    }
    
    // Legacy format deprecated, skip image segment
    currentPosition = match.index + match[0].length;
  }
  
  // Add final text segment
  if (currentPosition < content.length) {
    const textContent = content.substring(currentPosition).trim();
    if (textContent) {
      segments.push({
        type: 'text',
        content: textContent,
        id: `${messageId}_segment_${segmentIndex++}`,
        originalMessageId: messageId,
        segmentIndex: segmentIndex - 1
      });
    }
  }
  
  return segments;
};

// 🆕 Parse new format image content - IMAGE_REGISTRY format (no IMG_REF)
const parseNewFormatMessage = (content: string, messageId: string, isStreaming: boolean = false): MessageSegment[] => {
  console.log('🎬 [parseNewFormatMessage] START - messageId:', messageId, 'isStreaming:', isStreaming);
  console.log('📝 [parseNewFormatMessage] Content length:', content.length);
  
  const segments: MessageSegment[] = [];
  let segmentIndex = 0;
  let currentPosition = 0;
  
  // 🔥 Fix: Use global regex to find all IMAGE_REGISTRY tag pairs
  const registryRegex = /<IMAGE_REGISTRY>\s*([\s\S]*?)\s*<\/IMAGE_REGISTRY>/g;
  let match;
  let foundAnyRegistry = false;
  
  // Process all complete IMAGE_REGISTRY tag pairs
  while ((match = registryRegex.exec(content)) !== null) {
    foundAnyRegistry = true;
    const matchStart = match.index;
    const matchEnd = match.index + match[0].length;
    const registryContent = match[1].trim();
    
    console.log(`🔍 [parseNewFormatMessage] Found IMAGE_REGISTRY at position ${matchStart}-${matchEnd}`);
    
    // Add text segment before IMAGE_REGISTRY
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
        console.log(`📝 [parseNewFormatMessage] Added text segment before registry: ${beforeText.length} chars`);
      }
    }
    
    // Parse images in the current IMAGE_REGISTRY
    const imageRegistry = new Map<string, any>();
    
    if (registryContent) {
      const lines = registryContent.split('\n');
      console.log('📊 [parseNewFormatMessage] Processing', lines.length, 'registry lines');
      for (const line of lines) {
        const trimmedLine = line.trim();
        if (trimmedLine) {
          try {
            const imageData = JSON.parse(trimmedLine);
            if (imageData.id) {
              imageRegistry.set(imageData.id, imageData);
              console.log('🖼️ [parseNewFormatMessage] Registered image:', imageData.id);
            }
          } catch (error) {
            console.log('⚠️ [parseNewFormatMessage] Skipping non-JSON line:', trimmedLine.substring(0, 50));
          }
        }
      }
    }
    
    // Add image gallery segment (if there are images)
    if (imageRegistry.size > 0) {
      segments.push({
        type: 'image-gallery',
        content: '', // Image gallery does not need content
        id: `${messageId}_gallery_${segmentIndex++}`,
        originalMessageId: messageId,
        segmentIndex: segmentIndex - 1,
        imageRegistry: imageRegistry
      });
      console.log(`🎨 [parseNewFormatMessage] Added gallery segment with ${imageRegistry.size} images`);
    }
    
    // Update current position
    currentPosition = matchEnd;
  }
  
  // If no complete IMAGE_REGISTRY was found
  if (!foundAnyRegistry) {
    console.log('⚠️ [parseNewFormatMessage] No complete IMAGE_REGISTRY found');
    
    // Check if there is an incomplete IMAGE_REGISTRY opening tag
    const hasRegistryStart = content.includes('<IMAGE_REGISTRY>');
    
    if (hasRegistryStart) {
      console.log('🔄 [parseNewFormatMessage] IMAGE_REGISTRY is still streaming');
      
      const registryStartIndex = content.indexOf('<IMAGE_REGISTRY>');
      
      // Render content before IMAGE_REGISTRY
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
      
      // If streaming, render content after IMAGE_REGISTRY tag (if any)
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
      
      console.log('⏳ [parseNewFormatMessage] Waiting for IMAGE_REGISTRY to complete...');
      return segments;
    }
    
    // No IMAGE_REGISTRY tag at all, render all text
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
  
  // Process content after the last IMAGE_REGISTRY
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
      console.log(`📄 [parseNewFormatMessage] Added final text segment: ${afterLastRegistry.length} chars`);
    }
  }
  
  console.log('✅ [parseNewFormatMessage] END - Total segments:', segments.length);
  console.log('📊 [parseNewFormatMessage] Segment types:', segments.map(s => s.type).join(', '));
  
  return segments;
};

// 🆕 Image cache manager - uses Map to store URL -> Base64 mappings
const imageCache = new Map<string, string>();

// 🆕 New image gallery component - Google search style multi-row layout, fixed height, dynamic width
const ImageGalleryNew: React.FC<{ imageRegistry: Map<string, any>; messageId: string }> = ({ imageRegistry, messageId }) => {
  const [loadingStates, setLoadingStates] = useState<Map<string, boolean>>(new Map());
  const [errorStates, setErrorStates] = useState<Map<string, boolean>>(new Map());
  const [cachedUrls, setCachedUrls] = useState<Map<string, string>>(new Map());
  const [imageDimensions, setImageDimensions] = useState<Map<string, { width: number; height: number }>>(new Map());

  const FIXED_HEIGHT = 130; // Fixed height

  // Initialize loading states and cache check
  useEffect(() => {
    const initialLoadingStates = new Map<string, boolean>();
    const initialCachedUrls = new Map<string, string>();
    
    imageRegistry.forEach((imageData, id) => {
      const url = imageData.url;
      
      // Check if already cached
      if (imageCache.has(url)) {
        // Use cached image
        initialCachedUrls.set(id, imageCache.get(url)!);
        initialLoadingStates.set(id, false);
      } else {
        // Needs loading
        initialLoadingStates.set(id, true);
        // Start preloading and caching
        cacheImage(url, id);
      }
    });
    
    setLoadingStates(initialLoadingStates);
    setCachedUrls(initialCachedUrls);
  }, [imageRegistry]);

  // Image cache function - converts remote images to Base64 and caches them
  const cacheImage = async (url: string, imageId: string) => {
    try {
      // If already in cache, use directly
      if (imageCache.has(url)) {
        setCachedUrls(prev => {
          const newMap = new Map(prev);
          newMap.set(imageId, imageCache.get(url)!);
          return newMap;
        });
        setLoadingStates(prev => {
          const newMap = new Map(prev);
          newMap.set(imageId, false);
          return newMap;
        });
        return;
      }

      // Use fetch to download image
      const response = await fetch(url);
      const blob = await response.blob();
      
      // Convert to Base64
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64data = reader.result as string;
        
        // Store in global cache
        imageCache.set(url, base64data);
        
        // Update component state
        setCachedUrls(prev => {
          const newMap = new Map(prev);
          newMap.set(imageId, base64data);
          return newMap;
        });
        
        setLoadingStates(prev => {
          const newMap = new Map(prev);
          newMap.set(imageId, false);
          return newMap;
        });
      };
      
      reader.onerror = () => {
        handleImageError(imageId);
      };
      
      reader.readAsDataURL(blob);
    } catch (error) {
      console.error('Failed to cache image:', url, error);
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

  // Handle image load complete, get dimensions
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

  // Click image to open fullscreen viewer
  const handleImageClick = (clickedIndex: number) => {
    // 🔥 Fix: Filter out invalid image data, ensure all elements have url property
    const galleryImages = images
      .filter((imageData) => imageData && imageData.url) // Filter invalid data
      .map((imageData) => ({
        id: imageData.id || `unknown-${Date.now()}`,
        url: cachedUrls.get(imageData.id) || imageData.url,
        alt: imageData.alt || `Image ${imageData.id || 'unknown'}`
      }));

    if (galleryImages.length === 0) {
      console.warn('🚨 [ImageGallery] No valid images found for viewer');
      return;
    }

    window.dispatchEvent(new CustomEvent('imageViewer:open', {
      detail: {
        images: galleryImages,
        initialIndex: Math.min(clickedIndex, galleryImages.length - 1) // Ensure index is valid
      }
    }));
  };

  // Prepare complete gallery data for context menu
  const galleryImages = images
    .filter((imageData) => imageData && imageData.url) // 🔥 Fix: Filter invalid data
    .map((imageData) => ({
      id: imageData.id || `unknown-${Date.now()}`,
      url: cachedUrls.get(imageData.id) || imageData.url,
      alt: imageData.alt || `Image ${imageData.id || 'unknown'}`
    }));

  return (
    <div className="image-gallery-new">
      {/* New Google search results style image grid container */}
      <div className="gallery-grid-container">
        {images.map((imageData, index) => {
          // Validate image data
          if (!imageData || !imageData.url) {
            console.warn('🚨 [ImageGalleryNew] Skipping invalid image data at index:', index, imageData);
            return null;
          }

          const isLoading = loadingStates.get(imageData.id) ?? true;
          const hasError = errorStates.get(imageData.id) ?? false;
          const cachedUrl = cachedUrls.get(imageData.id) || imageData.url;
          
          // Calculate image width: based on fixed height and image aspect ratio
          const dimensions = imageDimensions.get(imageData.id);
          let calculatedWidth = 130; // Default width, avoid being 0
          if (dimensions && dimensions.height > 0) {
            const aspectRatio = dimensions.width / dimensions.height;
            calculatedWidth = Math.round(FIXED_HEIGHT * aspectRatio);
          }

          return (
            <div 
              key={imageData.id || `fallback-${index}`} 
              className="gallery-grid-item"
              style={{
                width: `${calculatedWidth}px`,
                maxWidth: '100%', // 🔥 Dynamically limit max width to 100% of container, prevent oversized images from overflowing
                backgroundImage: !isLoading && !hasError ? `url(${cachedUrl})` : 'none',
                backgroundColor: '#D9D9D9'
              }}
              onClick={!isLoading && !hasError ? () => handleImageClick(index) : undefined}
              onContextMenu={!isLoading && !hasError ? (e) => {
                e.preventDefault();
                e.stopPropagation();
                // Trigger ImageGallery context menu event, pass complete gallery info
                window.dispatchEvent(new CustomEvent('imageGallery:contextMenu', {
                  detail: {
                    event: e,
                    imageData: {
                      url: cachedUrl,
                      alt: imageData.alt,
                      index: index
                    },
                    galleryImages: galleryImages, // Pass complete gallery
                    initialIndex: index // Current image index
                  }
                }));
              } : undefined}
              title={!isLoading && !hasError ? "Click to enlarge | Right-click for more options" : undefined}
            >
              {/* Loading state - displayed at center of image container */}
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
                  <span className="error-text">Failed to load image</span>
                </div>
              )}
              
              {/* Hidden img for triggering onLoad/onError events and getting image dimensions */}
              {!hasError && (
                <img
                  src={cachedUrl}
                  alt={imageData.alt || `Image ${imageData.id}`}
                  onLoad={(e) => handleImageLoadWithDimensions(imageData.id, e.currentTarget)}
                  onError={() => handleImageError(imageData.id)}
                  style={{ display: 'none' }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// 🗑️ DEPRECATED: Legacy image gallery component - left/right arrow navigation horizontal scroll + local cache + scroll sync
// Please use ImageGalleryNew instead, new version uses Google search style layout
const ImageGallery: React.FC<{ imageRegistry: Map<string, any>; messageId: string }> = ({ imageRegistry, messageId }) => {
  const [loadingStates, setLoadingStates] = useState<Map<string, boolean>>(new Map());
  const [errorStates, setErrorStates] = useState<Map<string, boolean>>(new Map());
  const [cachedUrls, setCachedUrls] = useState<Map<string, string>>(new Map());
  const [currentIndex, setCurrentIndex] = useState(0);
  const galleryRef = useRef<HTMLDivElement>(null);
  const isScrollingRef = useRef(false);

  // Initialize loading states and cache check
  useEffect(() => {
    const initialLoadingStates = new Map<string, boolean>();
    const initialCachedUrls = new Map<string, string>();
    
    imageRegistry.forEach((imageData, id) => {
      const url = imageData.url;
      
      // Check if already cached
      if (imageCache.has(url)) {
        // Use cached image
        initialCachedUrls.set(id, imageCache.get(url)!);
        initialLoadingStates.set(id, false);
      } else {
        // Needs loading
        initialLoadingStates.set(id, true);
        // Start preloading and caching
        cacheImage(url, id);
      }
    });
    
    setLoadingStates(initialLoadingStates);
    setCachedUrls(initialCachedUrls);
  }, [imageRegistry]);

  // Image cache function - converts remote images to Base64 and caches them
  const cacheImage = async (url: string, imageId: string) => {
    try {
      // If already in cache, use directly
      if (imageCache.has(url)) {
        setCachedUrls(prev => {
          const newMap = new Map(prev);
          newMap.set(imageId, imageCache.get(url)!);
          return newMap;
        });
        setLoadingStates(prev => {
          const newMap = new Map(prev);
          newMap.set(imageId, false);
          return newMap;
        });
        return;
      }

      // Use fetch to download image
      const response = await fetch(url);
      const blob = await response.blob();
      
      // Convert to Base64
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64data = reader.result as string;
        
        // Store in global cache
        imageCache.set(url, base64data);
        
        // Update component state
        setCachedUrls(prev => {
          const newMap = new Map(prev);
          newMap.set(imageId, base64data);
          return newMap;
        });
        
        setLoadingStates(prev => {
          const newMap = new Map(prev);
          newMap.set(imageId, false);
          return newMap;
        });
      };
      
      reader.onerror = () => {
        handleImageError(imageId);
      };
      
      reader.readAsDataURL(blob);
    } catch (error) {
      console.error('Failed to cache image:', url, error);
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

  const images = Array.from(imageRegistry.values());
  
  if (images.length === 0) {
    return null;
  }

  // 🆕 Listen to scroll events, update currentIndex
  useEffect(() => {
    const gallery = galleryRef.current;
    if (!gallery) return;

    const handleScroll = () => {
      if (isScrollingRef.current) return; // Do not update during programmatic scrolling

      const scrollLeft = gallery.scrollLeft;
      const itemWidth = 312; // 300px + 12px gap
      const newIndex = Math.round(scrollLeft / itemWidth);
      
      if (newIndex !== currentIndex && newIndex >= 0 && newIndex < images.length) {
        setCurrentIndex(newIndex);
      }
    };

    gallery.addEventListener('scroll', handleScroll, { passive: true });
    return () => gallery.removeEventListener('scroll', handleScroll);
  }, [currentIndex, images.length]);

  // Left/right arrow navigation
  const handlePrev = () => {
    if (currentIndex > 0) {
      const newIndex = currentIndex - 1;
      setCurrentIndex(newIndex);
      scrollToIndex(newIndex);
    }
  };

  const handleNext = () => {
    if (currentIndex < images.length - 1) {
      const newIndex = currentIndex + 1;
      setCurrentIndex(newIndex);
      scrollToIndex(newIndex);
    }
  };

  const scrollToIndex = (index: number) => {
    if (galleryRef.current) {
      isScrollingRef.current = true; // Mark as programmatic scrolling
      const itemWidth = 312; // 300px + 12px gap
      galleryRef.current.scrollTo({
        left: index * itemWidth,
        behavior: 'smooth'
      });
      
      // Reset flag after scrolling completes
      setTimeout(() => {
        isScrollingRef.current = false;
      }, 500);
    }
  };

  const canGoPrev = currentIndex > 0;
  const canGoNext = currentIndex < images.length - 1;

  // Click image to open fullscreen viewer
  const handleImageClick = (clickedIndex: number) => {
    // 🔥 Fix: Filter out invalid image data, ensure all elements have url property
    const galleryImages = images
      .filter((imageData) => imageData && imageData.url) // Filter invalid data
      .map((imageData) => ({
        id: imageData.id || `unknown-${Date.now()}`,
        url: cachedUrls.get(imageData.id) || imageData.url,
        alt: imageData.alt || `Image ${imageData.id || 'unknown'}`
      }));

    if (galleryImages.length === 0) {
      console.warn('🚨 [ImageGallery] No valid images found for viewer');
      return;
    }

    window.dispatchEvent(new CustomEvent('imageViewer:open', {
      detail: {
        images: galleryImages,
        initialIndex: Math.min(clickedIndex, galleryImages.length - 1) // Ensure index is valid
      }
    }));
  };

  // Prepare complete gallery data for context menu
  const galleryImages = images
    .filter((imageData) => imageData && imageData.url) // 🔥 Fix: Filter invalid data
    .map((imageData) => ({
      id: imageData.id || `unknown-${Date.now()}`,
      url: cachedUrls.get(imageData.id) || imageData.url,
      alt: imageData.alt || `Image ${imageData.id || 'unknown'}`
    }));

  return (
    <div className="image-gallery-wrapper">
      {/* Left arrow */}
      {images.length > 1 && canGoPrev && (
        <button
          className="gallery-nav-btn gallery-nav-prev"
          onClick={handlePrev}
          aria-label="Previous image"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"></polyline>
          </svg>
        </button>
      )}

      {/* Image gallery */}
      <div className="image-gallery" ref={galleryRef}>
        {images.map((imageData, index) => {
          // 🔥 Fix: Validate image data
          if (!imageData || !imageData.url) {
            console.warn('🚨 [ImageGallery] Skipping invalid image data at index:', index, imageData);
            return null;
          }

          const isLoading = loadingStates.get(imageData.id) ?? true;
          const hasError = errorStates.get(imageData.id) ?? false;
          const cachedUrl = cachedUrls.get(imageData.id) || imageData.url;

          return (
            <div key={imageData.id || `fallback-${index}`} className="image-gallery-item">
              {/* Loading state - displayed at center of image container */}
              {isLoading && (
                <div className="image-loading-overlay">
                  <div className="loading-spinner">
                    <div className="spinner-circle"></div>
                  </div>
                  <div className="loading-text">Loading...</div>
                </div>
              )}
              
              {/* Error state */}
              {hasError ? (
                <div className="image-error-placeholder">
                  <span className="error-icon">⚠️</span>
                  <span className="error-text">Failed to load image</span>
                  <span className="error-detail">{imageData.alt || imageData.id}</span>
                </div>
              ) : (
                /* Image - uses cached URL, centered horizontally and vertically, clickable to enlarge */
                <img
                  src={cachedUrl}
                  alt={imageData.alt || `Image ${imageData.id}`}
                  className="gallery-image clickable"
                  onClick={() => handleImageClick(index)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    // Trigger ImageGallery context menu event, pass complete gallery info
                    window.dispatchEvent(new CustomEvent('imageGallery:contextMenu', {
                      detail: {
                        event: e,
                        imageData: {
                          url: cachedUrl,
                          alt: imageData.alt,
                          index: index
                        },
                        galleryImages: galleryImages, // Pass complete gallery
                        initialIndex: index // Current image index
                      }
                    }));
                  }}
                  onLoad={() => handleImageLoad(imageData.id)}
                  onError={() => handleImageError(imageData.id)}
                  style={{
                    display: isLoading ? 'none' : 'block',
                    objectFit: 'contain', /* Maintain aspect ratio, display completely */
                    objectPosition: 'center', /* Center horizontally and vertically */
                    cursor: 'pointer' /* Show pointer on hover */
                  }}
                  title="Click to enlarge | Right-click for more options"
                />
              )}
              
              {/* Image caption */}
              {imageData.alt && !hasError && !isLoading && (
                <div className="image-caption">{imageData.alt}</div>
              )}
            </div>
          );
        })}
      </div>

      {/* Right arrow */}
      {images.length > 1 && canGoNext && (
        <button
          className="gallery-nav-btn gallery-nav-next"
          onClick={handleNext}
          aria-label="Next image"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6"></polyline>
          </svg>
        </button>
      )}

      {/* Image indicators */}
      {images.length > 1 && (
        <div className="gallery-indicators">
          {images.map((imageData, index) => {
            // 🔥 Fix: Only show indicators for valid images
            if (!imageData || !imageData.url) {
              return null;
            }
            
            return (
              <button
                key={imageData.id || index}
                className={`gallery-indicator ${index === currentIndex ? 'active' : ''}`}
                onClick={() => {
                  setCurrentIndex(index);
                  scrollToIndex(index);
                }}
                aria-label={`View image ${index + 1}`}
              />
            );
          })}
        </div>
      )}
    </div>
  );
};

const Message: React.FC<MessageProps> = ({ message, isStreaming = false, onContentChange, cachedFilePaths = [], presentedFiles = [] }) => {
  const [isCopied, setIsCopied] = useState(false);
  const [fileMenuOpen, setFileMenuOpen] = useState<{[key: string]: boolean}>({});
  const [fileMenuPosition, setFileMenuPosition] = useState<{[key: string]: {top: number, left: number}}>({});

  const { showToast } = useToast();
  // Handle file menu toggle
  const handleFileMenuToggle = (filePath: string, event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const button = event.currentTarget;
    const rect = button.getBoundingClientRect();
    
    const isCurrentlyOpen = fileMenuOpen[filePath];
    
    // Close all other menus
    setFileMenuOpen({ [filePath]: !isCurrentlyOpen });
    
    if (!isCurrentlyOpen) {
      setFileMenuPosition(prev => ({
        ...prev,
        [filePath]: {
          top: rect.bottom + 4,
          left: rect.left
        }
      }));
    }
  };
  
  // Open file
  const handleOpenFile = async (filePath: string) => {
    try {
      console.log('🔍 [Message] Opening file:', filePath);
      const result = await window.electronAPI.workspace?.openPath(filePath);
      if (result?.success) {
        setFileMenuOpen({});
      } else {
        console.error('❌ [Message] Failed to open file:', result?.error);
        showToast(result?.error || 'Unable to open file', 'error');
      }
    } catch (error) {
      console.error('Failed to open file:', error);
      showToast('Unable to open file', 'error');
    }
  };
  
  // Show in folder
  const handleShowInFolder = async (filePath: string) => {
    try {
      const result = await window.electronAPI.workspace?.showInFolder(filePath);
      if (result?.success) {
        setFileMenuOpen({});
      } else {
        showToast(result?.error || 'Unable to open folder', 'error');
      }
    } catch (error) {
      console.error('Failed to show in folder:', error);
      showToast('Unable to open folder', 'error');
    }
  };

  const isSkillFile = (filePath: string): boolean => {
    return filePath.toLowerCase().endsWith('.skill');
  };

  const handleInstallSkill = async (filePath: string) => {
    try {
      if (!window.electronAPI?.skillLibrary?.installSkillFromFilePath) {
        showToast('Install skill API not available', 'error');
        return;
      }

      const result = await window.electronAPI.skillLibrary.installSkillFromFilePath(filePath);

      if (result.success) {
        showToast(`Skill "${result.skillName}" installed successfully`, 'success');
        // Trigger skills list refresh
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('skills:refreshFolderExplorer', {
            detail: { skillName: result.skillName }
          }));
        }, 600);

        // Show Apply to Agents dialog only for new installs (not overwrites)
        if (result.skillName && !result.isOverwrite) {
          window.dispatchEvent(new CustomEvent('skills:applyToAgents', {
            detail: { skillName: result.skillName }
          }));
        }
      } else if (result.error && result.error !== 'User cancelled the operation') {
        showToast(result.error, 'error', undefined, { persistent: true });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      showToast(`Failed to install skill: ${errorMessage}`, 'error');
    }
  };
  
  // Click outside to close menu
  useEffect(() => {
    const handleClickOutside = () => {
      setFileMenuOpen({});
    };
    
    if (Object.values(fileMenuOpen).some(open => open)) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [fileMenuOpen]);
  
  const getMessageClass = () => {
    switch (message.role) {
      case 'user':
        return 'message user-message';
      case 'assistant':
        // If has tool_calls, add has-tool-calls class name
        return message.tool_calls && message.tool_calls.length > 0
          ? 'message assistant-message has-tool-calls'
          : 'message assistant-message';
      case 'system':
        return message.name?.startsWith('tool')
          ? 'message tool-system-message'
          : 'message system-message';
      case 'tool':
        return 'message tool-message';
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
        return message.name?.startsWith('tool')
          ? 'message-container tool-system-message-container'
          : 'message-container system-message-container';
      case 'tool':
        return 'message-container tool-message-container';
      default:
        return 'message-container';
    }
  };

  // 🔥 Tool calls are rendered uniformly by ChatContainer, Message no longer renders them
  const renderToolCalls = () => {
    return null;
  };



  // Render file path attachments
  // 🔥 Determine if file is an image
  const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'ico', 'tiff', 'tif', 'avif']);
  const isImageFile = (filePath: string): boolean => {
    const ext = filePath.split('.').pop()?.toLowerCase() || '';
    return IMAGE_EXTENSIONS.has(ext);
  };

  // 🔥 Click file card: preview images with overlayImageViewer, non-images with overlayFileViewer
  const handleFileCardClick = (filePath: string, fileName: string) => {
    if (isImageFile(filePath)) {
      window.dispatchEvent(
        new CustomEvent('imageViewer:open', {
          detail: {
            images: [{ id: `file-attach-${filePath}`, url: filePath, alt: fileName }],
            initialIndex: 0,
          },
        }),
      );
    } else {
      window.dispatchEvent(
        new CustomEvent('fileViewer:open', {
          detail: {
            file: {
              name: fileName,
              url: filePath,
            },
          },
        }),
      );
    }
  };

  const renderFilePathAttachments = (filePaths: Array<{ path: string; exists: boolean }>) => {
    if (filePaths.length === 0) return null;
    
    return (
      <>
        <div className="message-file-attachments">
          <div className="file-attachments-list">
            {/* 🔥 Render cached file paths, show existence status */}
            {filePaths.map((fileInfo, index) => {
              const { path: filePath, exists } = fileInfo;
              // 🔥 Fix: Correctly extract filename on Mac, prioritize Unix-style path separators
              const fileName = (() => {
                // First try Unix-style path separator (Mac/Linux)
                if (filePath.includes('/')) {
                  return filePath.split('/').pop() || filePath;
                }
                // Then try Windows-style path separator
                if (filePath.includes('\\')) {
                  return filePath.split('\\').pop() || filePath;
                }
                // If neither found, it is already a filename
                return filePath;
              })();
              return (
                <div
                  key={index}
                  className={`file-attachment-item ${exists ? 'clickable' : 'deleted'}`}
                  onClick={() => exists && handleFileCardClick(filePath, fileName)}
                  title={exists ? `Click to open: ${filePath}` : `File deleted: ${filePath}`}
                  style={!exists ? { opacity: 0.6, cursor: 'not-allowed' } : undefined}
                >
                  <span className="file-attachment-icon"><FileTypeIcon fileName={fileName} size={24} /></span>
                  <span className="file-attachment-name" title={filePath}>
                    {fileName}
                  </span>
                  {/* 🔥 Show deleted status badge */}
                  {!exists && (
                    <span className="file-attachment-deleted-badge" style={{
                      marginLeft: '6px',
                      fontSize: '11px',
                      color: '#ef4444',
                      backgroundColor: 'rgba(239, 68, 68, 0.1)',
                      padding: '1px 6px',
                      borderRadius: '4px',
                      fontWeight: 500
                    }}>
                      deleted
                    </span>
                  )}
                  
                  {/* Menu button - only show when file exists */}
                  {exists && (
                    <button
                      className="file-attachment-menu-trigger"
                      onClick={(e) => handleFileMenuToggle(filePath, e)}
                      title="More options"
                    >
                      <MoreHorizontal size={16} strokeWidth={2} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        
        {/* Use Portal to render menu to body - 🔥 Render menus for all cached file paths (only render existing files) */}
        {Object.entries(fileMenuOpen).map(([filePath, isOpen]) => {
          const fileInfo = filePaths.find(f => f.path === filePath);
          if (!fileInfo || !fileInfo.exists) return null;
          if (!isOpen) return null;
          const menuPos = fileMenuPosition[filePath];
          if (!menuPos) return null;
          const menuFileName = (() => {
            if (filePath.includes('/')) return filePath.split('/').pop() || filePath;
            if (filePath.includes('\\')) return filePath.split('\\').pop() || filePath;
            return filePath;
          })();
          
          return ReactDOM.createPortal(
            <div
              key={filePath}
              className="file-attachment-menu"
              style={{
                top: `${menuPos.top}px`,
                left: `${menuPos.left}px`
              }}
            >
              <button
                className="file-attachment-menu-item"
                onClick={() => { setFileMenuOpen({}); handleFileCardClick(filePath, menuFileName); }}
              >
                <span className="file-attachment-menu-item-icon">
                  <Eye size={16} strokeWidth={2} />
                </span>
                <span className="file-attachment-menu-item-text">Preview file</span>
              </button>
              <button
                className="file-attachment-menu-item"
                onClick={() => handleOpenFile(filePath)}
              >
                <span className="file-attachment-menu-item-icon">
                  <FolderOpen size={16} strokeWidth={2} />
                </span>
                <span className="file-attachment-menu-item-text">Open file with default app</span>
              </button>
              <button
                className="file-attachment-menu-item"
                onClick={() => handleShowInFolder(filePath)}
              >
                <span className="file-attachment-menu-item-icon">
                  <Folder size={16} strokeWidth={2} />
                </span>
                <span className="file-attachment-menu-item-text">Open file in folder</span>
              </button>
              {isSkillFile(filePath) && (
                <button
                  className="file-attachment-menu-item"
                  onClick={() => { setFileMenuOpen({}); handleInstallSkill(filePath); }}
                >
                  <span className="file-attachment-menu-item-icon">
                    <Download size={16} strokeWidth={2} />
                  </span>
                  <span className="file-attachment-menu-item-text">Install skill</span>
                </button>
              )}
            </div>,
            document.body
          );
        })}
      </>
    );
  };

  // 🔥 Open OverlayImageViewer (via global custom event)
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

  // 🔥 Open OverlayFileViewer (via global custom event)
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
          {/* Render image attachments - 🔥 click to open OverlayImageViewer */}
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
          
          {/* Render file attachments - 🔥 click to open OverlayFileViewer */}
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
          
          {/* Render Office attachments - 🔥 click to open OverlayFileViewer */}
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
          
          {/* Render other type file attachments - 🔥 click to open OverlayFileViewer */}
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


  // Extract text content - handle unified content format and malformed JSON format
  const extractTextContent = (content: any): string => {
    // If content is a string, return directly
    if (typeof content === 'string') {
      return content;
    }
    
    // 🔥 Fix: Prioritize handling JSON format content array [{type: "text", text: "..."}]
    if (Array.isArray(content) && content.length > 0) {
      // Extract all text type content
      const textParts = content
        .filter(part => part && typeof part === 'object' && part.type === 'text')
        .map(part => String(part.text || ''))
        .join('');
      
      if (textParts) {
        return textParts;
      }
      
      // If no text type found, try using MessageHelper
      if (typeof content[0] === 'object' && 'type' in content[0]) {
        return MessageHelper.getText(message);
      }
    }
    
    // If content is another type of object, avoid displaying JSON
    if (content && typeof content === 'object') {
      // If it is an empty object or meaningless object, return empty string
      return '';
    }
    
    return String(content || '');
  };

  // Function to copy message content
  const handleCopyMessage = async () => {
    try {
      const textContent = extractTextContent(message.content);
      await navigator.clipboard.writeText(textContent);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 500); // Reset after 0.5 seconds
    } catch (error) {
    }
  };

  // 🆕 New: Segmented rendering function
  const renderSegmentedMessage = (message: MessageType, content: string, isContentStreaming: boolean) => {
    const segments = parseMessageIntoSegments(content, message.id || 'unknown', isContentStreaming);
    

    return (
      <div className="segmented-message">
        {segments.map((segment, index) => (
          <div key={segment.id} className={`segment segment-${segment.type} ${index === segments.length - 1 && isContentStreaming ? 'streaming' : ''}`}>
            {segment.type === 'text' ? (
              <div className={getMessageClass()}>
                <div className={`message-content markdown-body ${index === segments.length - 1 && isContentStreaming ? 'streaming' : ''}`}>
                  <div className="flex items-start">
                    <div className="flex-1">
                      {/* Use the same rendering approach as original logic */}
                      {(() => {
                        // 🔥 Fix: Always use StreamingV2Message to render text segments, ensuring consistent style during and after streaming
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
                {/* 🔥 Fix: Add message metadata - only show for last segment, when content is not streaming, and not an assistant message with tool_calls */}
                {index === segments.length - 1 && !isContentStreaming && !(message.tool_calls && message.tool_calls.length > 0) && (
                  <div className="message-meta">
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
                )}
              </div>
            ) : null}
          </div>
        ))}
        {/* 🔥 Fix: Also render tool_calls in segmented messages */}
        {renderToolCalls()}
      </div>
    );
  };

  // 🆕 New: New format image rendering function
  const renderNewFormatMessage = (message: MessageType, content: string, isContentStreaming: boolean) => {
    console.log('🎨 [renderNewFormatMessage] START - messageId:', message.id, 'isContentStreaming:', isContentStreaming);
    console.log('📏 [renderNewFormatMessage] Content length:', content.length);
    
    const segments = parseNewFormatMessage(content, message.id || 'unknown', isContentStreaming);
    
    console.log('🎨 [renderNewFormatMessage] Got', segments.length, 'segments to render');
    
    return (
      <div className="segmented-message new-format">
        {segments.map((segment, index) => (
          <div key={segment.id} className={`segment segment-${segment.type} ${index === segments.length - 1 && isContentStreaming ? 'streaming' : ''}`}>
            {segment.type === 'text' ? (
              <div className={getMessageClass()}>
                <div className={`message-content markdown-body ${index === segments.length - 1 && isContentStreaming ? 'streaming' : ''}`}>
                  <div className="flex items-start">
                    <div className="flex-1">
                      {/* 🔥 Fix: Always use StreamingV2Message to render text segments, ensuring consistent style during and after streaming */}
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
              // 🆕 Image gallery segment - uses ImageGalleryNew component (Google search multi-row style)
              <div className={getMessageClass()}>
                <div className="message-content">
                  <div className="flex items-start">
                    <div className="flex-1">
                      <ImageGalleryNew imageRegistry={segment.imageRegistry!} messageId={message.id || 'unknown'} />
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        ))}
        {/* 🔥 Message metadata: file attachments + action buttons, at same level as segment */}
        {!isContentStreaming && !(message.tool_calls && message.tool_calls.length > 0) && (
          <div className="message-meta">
            {/* File attachments area: presentedFiles takes priority, otherwise fallback to file paths extracted from text */}
            {presentedFiles.length > 0 ? (
              <PresentedFilesCard files={presentedFiles} />
            ) : (
              renderFilePathAttachments(cachedFilePaths)
            )}
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
        {/* 🔥 Fix: Also render tool_calls in new format messages */}
        {renderToolCalls()}
      </div>
    );
  };

  // 🔥 Debug: Log message rendering
  if (message.id?.startsWith('say-hi')) {
    console.log('🎉 [Message] Rendering say-hi message:', {
      id: message.id,
      role: message.role,
      contentLength: Array.isArray(message.content) 
        ? (message.content[0] as any)?.text?.length 
        : 0
    });
  }

  // Do not render tool messages and system messages
  if (message.role === 'tool' || message.role === 'system') {
    return null;
  }

  // 🔥 Refactor: Remove thinking message rendering logic
  // Now all assistant messages are rendered directly, no more thinking type
  if (message.role === 'thinking' as any) {
    // Keep empty branch for backward compatibility, but should not reach here
    console.warn('[Message] Unexpected thinking role message - this should not happen after refactoring');
    return null;
  }

  // Optimize markdown rendering content during streaming
  const optimizeContentForMarkdown = (content: string, isStreaming: boolean): string => {
    if (!content) return content;
    
    // Clean up malformed list formatting that may cause rendering issues
    let cleanedContent = content;
    
    // Fix numbered lists that may have odd spacing
    cleanedContent = cleanedContent.replace(/^(\d+)\.\s*$/gm, '$1. ');
    
    // Ensure proper line breaks for lists
    cleanedContent = cleanedContent.replace(/(\d+\.\s[^\n]*)\n(?=\d+\.)/g, '$1\n\n');
    
    // If streaming and content does not end with a complete markdown element,
    // ensure proper formatting of partial content
    if (isStreaming && message.role === 'assistant') {
      // Handle potentially incomplete partial code blocks
      const codeBlockMatches = cleanedContent.match(/```(\w+)?\n/g);
      const codeBlockClosures = cleanedContent.match(/\n```/g);
      
      if (codeBlockMatches && (!codeBlockClosures || codeBlockMatches.length > codeBlockClosures.length)) {
        // Has unclosed code block, temporarily do not add extra formatting
        return cleanedContent;
      }
      
      // Handle potentially incomplete inline code
      const inlineCodeMatches = cleanedContent.match(/`[^`]*$/);
      if (inlineCodeMatches) {
        // Potentially incomplete inline code
        return cleanedContent;
      }
      
      // Handle partial markdown syntax
      const partialMarkdown = cleanedContent.match(/(\*{1,2}|_{1,2}|#{1,6}|\[.*?\]|\()$/);
      if (partialMarkdown) {
        // Content ends with partial markdown syntax, render as-is
        return cleanedContent;
      }
    }
    
    return cleanedContent;
  };

  // 🔥 Process message content: remove <FINAL_SUMMARY> tag (used to identify final reply, should not be displayed to user)
  let rawContent = Array.isArray(message.content) ? extractTextContent(message.content) : String(message.content);
  // Remove leading <FINAL_SUMMARY> tag and trailing whitespace
  rawContent = rawContent.replace(/^\s*<FINAL_SUMMARY>\s*/, '');

  const processedContent = optimizeContentForMarkdown(rawContent, isStreaming);

  // 🆕 New: If assistant message contains new format images, use segmented rendering
  if (message.role === 'assistant' && hasNewImageFormat(processedContent)) {
      return renderNewFormatMessage(message, processedContent, isStreaming);
  }

  return (
    <div className={getMessageContainerClass()}>
      <div className={getMessageClass()}>
        <div className={`message-content markdown-body ${isStreaming ? 'streaming' : ''}`}>
          <div className="flex items-start">
            <div className="flex-1">
            {message.role === 'assistant' ? (
              // 🔥 Fix: Always use StreamingV2Message to render assistant messages, ensuring consistent style during and after streaming
              (() => {
                const streamingMessage: MessageType = {
                  ...message,
                  content: [{ type: 'text' as const, text: processedContent }]
                };
                
                return (
                  <StreamingV2Message
                    message={streamingMessage}
                    isStreaming={isStreaming}
                    enableMetricsDisplay={false}
                    onStreamingComplete={() => {
                    }}
                    onHeightChange={(newHeight) => {
                      if (onContentChange) {
                        onContentChange(processedContent, true);
                      }
                    }}
                  />
                );
              })()
            ) : (
              // 🔥 Fix: user message also uses StreamingV2Message to keep markdown style consistent
              (() => {
                const userMsg: MessageType = {
                  ...message,
                  content: [{ type: 'text' as const, text: processedContent }]
                };
                return (
                  <StreamingV2Message
                    message={userMsg}
                    isStreaming={false}
                    enableMetricsDisplay={false}
                  />
                );
              })()
            )}
            
            {/* Display attachment content - unified image and file attachment display */}
            {message.role === 'user' && renderAttachmentsContent()}
            </div>
          </div>
        </div>
        {renderToolCalls()}
      </div>
      {message.role === 'user' && (
        <div className="message-metadata">
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
      )}
      {message.role === 'assistant' && !isStreaming && !(message.tool_calls && message.tool_calls.length > 0) && (
        <>
          <div className="message-metadata">
            {/* 🔥 File attachments area: presentedFiles takes priority, otherwise fallback to file paths extracted from text */}
            {presentedFiles.length > 0 ? (
              <PresentedFilesCard files={presentedFiles} />
            ) : (
              renderFilePathAttachments(cachedFilePaths)
            )}
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

export default Message;