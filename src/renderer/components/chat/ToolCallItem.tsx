// src/renderer/components/chat/ToolCallItem.tsx
// Standalone Tool Call rendering component, supports expand/collapse and custom views

import React, { useState, useRef, useCallback } from 'react';
import { Loader2, ChevronRight } from 'lucide-react';
import { ToolCall, Message as MessageType } from '../../types/chatTypes';
import { getToolCallDisplayText, getToolCallIcon } from './toolCallDisplayConfig';
import { getToolCallView, hasCustomView } from './toolCallViews';

/**
 * Tool Call execution status
 */
export type ToolCallExecutionStatus = 'executing' | 'completed';

export interface ToolCallItemProps {
  /** Tool Call data */
  toolCall: ToolCall;
  /** Tool Result message (if completed) */
  toolResult: MessageType | null;
  /** Unique identifier, used for key */
  itemKey: string;
  /** Whether this is the last item */
  isLast?: boolean;
}

/**
 * Render tool icon
 * Shows loading spinner while executing, shows tool-type specific icon when completed
 */
const ToolIcon: React.FC<{ toolName: string; status: ToolCallExecutionStatus }> = ({ toolName, status }) => {
  if (status === 'executing') {
    return (
      <span className="tool-item-status-icon executing">
        <Loader2 size={16} className="animate-spin" style={{ display: 'block' }} />
      </span>
    );
  }

  // Completed state: show tool-type specific icon
  const IconComponent = getToolCallIcon(toolName);
  return (
    <span className="tool-item-status-icon completed">
      <IconComponent size={16} style={{ display: 'block' }} />
    </span>
  );
};

/**
 * ToolCallItem component
 * Renders a single Tool Call, supports expand/collapse to show custom views
 */
export const ToolCallItem: React.FC<ToolCallItemProps> = ({
  toolCall,
  toolResult,
  isLast = false,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);

  // Compute execution status: completed if toolResult exists, otherwise executing
  const executionStatus: ToolCallExecutionStatus = toolResult ? 'completed' : 'executing';

  // Get display text
  const displayText = getToolCallDisplayText(toolCall.function.name, toolCall.function.arguments);

  // Check if a custom view exists
  const toolName = toolCall.function.name;
  const hasCustom = hasCustomView(toolName);
  const CustomView = hasCustom ? getToolCallView(toolName) : null;

  // Whether expandable: only tools with custom views can be expanded
  const isExpandable = hasCustom;

  /**
   * Handle expand/collapse click
   * Maintains click position: expands downward, collapses upward
   */
  const handleToggle = useCallback(() => {
    if (!isExpandable) return;

    if (!rowRef.current) {
      setIsExpanded(!isExpanded);
      return;
    }

    // Record row position relative to viewport before click
    const rowRect = rowRef.current.getBoundingClientRect();
    const rowTopBeforeToggle = rowRect.top;

    // Toggle expanded state
    setIsExpanded(prev => !prev);

    // Use requestAnimationFrame to ensure DOM updates before adjusting scroll
    requestAnimationFrame(() => {
      if (!rowRef.current) return;

      // Get row position after update
      const newRowRect = rowRef.current.getBoundingClientRect();
      const rowTopAfterToggle = newRowRect.top;

      // Calculate position difference
      const diff = rowTopAfterToggle - rowTopBeforeToggle;

      // If there's a difference, adjust scroll position to keep row at its original viewport position
      if (Math.abs(diff) > 1) {
        // Find the nearest scrollable container (chat-container-reverse)
        const scrollContainer = rowRef.current.closest('.chat-container-reverse');
        if (scrollContainer) {
          scrollContainer.scrollTop += diff;
        }
      }
    });
  }, [isExpanded, isExpandable]);

  return (
    <div className={`tool-call-item-container ${isExpanded ? 'expanded' : ''} ${!isLast ? 'has-next' : ''}`}>
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

      {/* Expanded content: custom view */}
      {isExpanded && CustomView && (
        <div className="tool-call-expanded-content">
          <div className="tool-call-custom-view">
            <CustomView toolCall={toolCall} toolResult={toolResult} />
          </div>
        </div>
      )}
    </div>
  );
};

export default ToolCallItem;
