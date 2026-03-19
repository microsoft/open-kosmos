// src/renderer/components/chat/toolCallViews/WriteFileToolCallView.tsx
// Custom view component for Write File / Create File tool calls

import React from 'react';
import { ExternalLink } from 'lucide-react';
import { ToolCallViewProps, WriteFileToolArgs, WriteFileToolResult } from './types';
import { MessageHelper } from '../../../types/chatTypes';
import { parseStreamingJson } from '@renderer/lib/utils/streamingJsonParser';
import FileTypeIcon from '../../ui/FileTypeIcon';

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'ico', 'tiff', 'tif', 'avif']);

const isImageFile = (filePath: string): boolean => {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  return IMAGE_EXTENSIONS.has(ext);
};

/**
 * Parse tool call arguments
 */
const parseToolArgs = (argsStr: string): WriteFileToolArgs | undefined => {
  return parseStreamingJson<WriteFileToolArgs>(argsStr);
};

/**
 * Parse tool result content
 */
const parseToolResult = (content: string): WriteFileToolResult | null => {
  if (!content) return null;
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
};

/**
 * Extract file name from path
 */
const getFileName = (filePath: string): string => {
  const parts = filePath.split(/[/\\]/);
  return parts[parts.length - 1] || filePath;
};

/**
 * Open file in overlay viewer (image viewer for images, file viewer for others)
 */
const handleOpenFile = (filePath: string) => {
  const fileName = getFileName(filePath);
  if (isImageFile(filePath)) {
    // Open image in OverlayImageViewer
    window.dispatchEvent(
      new CustomEvent('imageViewer:open', {
        detail: {
          images: [{ id: `writefile-${filePath}`, url: filePath, alt: fileName }],
          initialIndex: 0,
        },
      }),
    );
  } else {
    // Open non-image in OverlayFileViewer
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

/**
 * Write File / Create File Tool Call custom view
 */
export const WriteFileToolCallView: React.FC<ToolCallViewProps> = ({
  toolCall,
  toolResult,
}) => {
  const args = parseToolArgs(toolCall.function.arguments);
  // Use MessageHelper.getText to extract text from UnifiedContentPart[]
  const resultText = toolResult ? MessageHelper.getText(toolResult) : '';
  const result = resultText ? parseToolResult(resultText) : null;

  // If no arguments, don't render
  if (!args || !args.filePath) {
    return null;
  }

  const isExecuting = !toolResult;
  const isSuccess = result?.success === true;
  const fileName = getFileName(args.filePath);

  // If executing (streaming), show content preview
  if (isExecuting && args.content) {
    return (
      <div className="write-file-view">
        <div className="write-file-streaming-container">
          <div className="write-file-streaming-header">
            <FileTypeIcon fileName={fileName} size={16} className="write-file-icon" />
            <span className="write-file-filename">{fileName}</span>
            <span className="write-file-streaming-indicator">Writing...</span>
          </div>
          <div className="write-file-content-preview">
            <pre className="write-file-content-pre">{args.content}</pre>
          </div>
        </div>
      </div>
    );
  }

  // After execution completes, show file link
  if (isSuccess && result) {
    return (
      <div className="write-file-view">
        <div
          className="write-file-success-container"
          onClick={() => handleOpenFile(result.filePath)}
        >
          <div className="write-file-success-content">
            <FileTypeIcon fileName={fileName} size={24} className="write-file-icon" />
            <span className="write-file-filename">{fileName}</span>
          </div>
          <ExternalLink size={14} className="write-file-open-icon" />
        </div>
      </div>
    );
  }

  // Execution failed case
  if (result && !isSuccess) {
    return (
      <div className="write-file-view">
        <div className="write-file-error-container">
          <FileTypeIcon fileName={fileName} size={24} className="write-file-icon error" />
          <span className="write-file-filename">{fileName}</span>
          <span className="write-file-error-text">{result.error || 'Failed to write file'}</span>
        </div>
      </div>
    );
  }

  return null;
};

export default WriteFileToolCallView;
