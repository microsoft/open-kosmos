// src/renderer/components/chat/ToolCallItem.tsx
// Standalone Tool Call rendering component with expand/collapse support and custom views

import React, { useState, useRef, useCallback } from 'react';
import { Loader2, ChevronRight, AlertCircle } from 'lucide-react';
import { ToolCall, Message as MessageType } from '@shared/types/chatTypes';
import { getToolCallDisplayText, getToolCallIcon } from './toolCallDisplayConfig';
import { getToolCallView, hasCustomView } from './toolCallViews';
import { ToolCallExecutionStatus } from './toolCallViews/types';
import { adjustScrollForExpandedContent } from './toolCallExpansionScroll';

export interface ToolCallItemProps {
  /** Tool Call data */
  toolCall: ToolCall;
  /** Tool Result message (if completed) */
  toolResult: MessageType | null;
  /** Execution status, computed by the parent based on chat session status */
  executionStatus: ToolCallExecutionStatus;
  /** Unique identifier, used as key */
  itemKey: string;
  /** Whether this is the last item */
  isLast?: boolean;
}

/**
 * Render the tool icon.
 * Shows a loading spinner while executing; shows the tool-type icon when done.
 */
const ToolIcon: React.FC<{ toolName: string; status: ToolCallExecutionStatus }> = ({ toolName, status }) => {
  if (status === 'executing') {
    return (
      <span className="tool-item-status-icon executing">
        <Loader2 size={16} className="animate-spin" style={{ display: 'block' }} />
      </span>
    );
  }

  if (status === 'interrupted') {
    return (
      <span className="tool-item-status-icon interrupted">
        <AlertCircle size={16} style={{ display: 'block' }} />
      </span>
    );
  }

  // Completed state: show the icon corresponding to the tool type
  const IconComponent = getToolCallIcon(toolName);
  return (
    <span className="tool-item-status-icon completed">
      <IconComponent size={16} style={{ display: 'block' }} />
    </span>
  );
};

/**
 * ToolCallItem component.
 * Renders a single Tool Call with expand/collapse support for the custom view.
 */
export const ToolCallItem: React.FC<ToolCallItemProps> = ({
  toolCall,
  toolResult,
  executionStatus,
  isLast = false,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);

  // Get display text
  const resultText = (toolResult?.content?.find((c) => c.type === 'text') as any)?.text as string | undefined;
  const displayText = getToolCallDisplayText(toolCall.function.name, toolCall.function.arguments, resultText);

  // Check whether there is a custom view
  const toolName = toolCall.function.name;
  const hasCustom = hasCustomView(toolName);
  const CustomView = hasCustom ? getToolCallView(toolName) : null;

  // Expandable only for tools that have a custom view
  const isExpandable = hasCustom;

  /**
   * Handle expand/collapse click.
   * Keep the click position stable: expand downward, collapse upward.
   */
  const handleToggle = useCallback(() => {
    if (!isExpandable) return;

    if (!rowRef.current || !containerRef.current) {
      setIsExpanded(!isExpanded);
      return;
    }

    // Record the row's position relative to the viewport before the click
    const rowRect = rowRef.current.getBoundingClientRect();
    const rowTopBeforeToggle = rowRect.top;

    // Toggle expand state
    setIsExpanded(prev => !prev);

    // Use requestAnimationFrame to adjust scroll after the DOM has updated
    requestAnimationFrame(() => {
      if (!rowRef.current || !containerRef.current) return;

      adjustScrollForExpandedContent({
        anchorElement: rowRef.current,
        targetElement: containerRef.current,
        anchorTopBeforeToggle: rowTopBeforeToggle,
      });
    });
  }, [isExpanded, isExpandable]);

  return (
    <div
      ref={containerRef}
      className={`tool-call-item-container ${isExpanded ? 'expanded' : ''} ${!isLast ? 'has-next' : ''}`}
    >
      {/* Main row: icon + text + arrow */}
      <div
        ref={rowRef}
        className={`tool-calls-row tool-call-item-row ${isExpandable ? 'expandable' : ''}`}
        onClick={handleToggle}
      >
        <div className="tool-calls-icon-col">
          <ToolIcon toolName={toolName} status={executionStatus} />
        </div>
        <div className="tool-calls-text-col">
          <span className="tool-call-item-text">{displayText}</span>
          {isExpandable && (
            <ChevronRight
              size={14}
              className={`tool-call-expand-arrow ${isExpanded ? 'expanded' : ''}`}
            />
          )}
        </div>
      </div>

      {/* Expanded content: custom view. Placed below the main row; when expanded, scroll compensation via reverse list pushes the main row upward. */}
      {isExpanded && CustomView && (
        <div className="tool-call-expanded-content">
          <div className="tool-call-custom-view">
            <CustomView toolCall={toolCall} toolResult={toolResult} executionStatus={executionStatus} />
          </div>
        </div>
      )}
    </div>
  );
};

export default ToolCallItem;
