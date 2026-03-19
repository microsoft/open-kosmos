// src/renderer/components/chat/ToolCallsSection.tsx
// Tool Calls Section component, renders the entire tool calls area, calculates overall execution status

import React, { useState, useRef, useCallback } from 'react';
import { Loader2, CheckCircle } from 'lucide-react';
import { ToolCall, Message as MessageType } from '../../types/chatTypes';
import { ToolCallItem } from './ToolCallItem';
import { getToolCallsSummaryText } from './toolCallDisplayConfig';

/**
 * Tool Calls overall execution status
 * - executing: All tools are still executing (no results yet)
 * - partial: Some tools have completed, some are still executing
 * - completed: All tools have completed
 */
export type ToolCallsSectionStatus = 'executing' | 'partial' | 'completed';

export interface ToolCallsSectionProps {
  /** Tool Calls array */
  toolCalls: ToolCall[];
  /** All messages (used to find tool results) */
  allMessages: MessageType[];
  /** Message ID (used to generate unique keys) */
  messageId?: string;
}

/**
 * Calculate Tool Calls overall execution status
 */
const computeToolCallsSectionStatus = (
  toolCalls: ToolCall[],
  allMessages: MessageType[]
): ToolCallsSectionStatus => {
  // Filter valid tool calls
  const validToolCalls = toolCalls.filter(tc =>
    tc.id && tc.id.trim() !== '' &&
    tc.function.name && tc.function.name.trim() !== ''
  );

  if (validToolCalls.length === 0) {
    return 'completed';
  }

  // Count the number of completed tool calls
  const completedCount = validToolCalls.filter(tc =>
    allMessages.some(msg =>
      msg.role === 'tool' && msg.tool_call_id === tc.id
    )
  ).length;

  if (completedCount === validToolCalls.length) {
    return 'completed';
  } else if (completedCount > 0) {
    return 'partial';
  } else {
    return 'executing';
  }
};

/**
 * Render status icon
 */
const StatusIcon: React.FC<{ status: ToolCallsSectionStatus }> = ({ status }) => {
  switch (status) {
    case 'executing':
    case 'partial':
      return (
        <span className={`tool-status-icon ${status}`}>
          <Loader2 size={16} className="animate-spin" style={{ display: 'block' }} />
        </span>
      );
    case 'completed':
      return (
        <span className="tool-status-icon completed">
          <CheckCircle size={16} style={{ display: 'block' }} />
        </span>
      );
    default:
      return null;
  }
};

/**
 * Arrow icon component
 */
const ArrowIcon: React.FC<{ isExpanded: boolean }> = ({ isExpanded }) => {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`tool-calls-arrow ${isExpanded ? 'expanded' : ''}`}
    >
      <path
        d="M6 4L10 8L6 12"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};

/**
 * ToolCallsSection component
 * Renders the entire Tool Calls area, including header status and all Tool Call items
 * Uses dashed lines to connect all icons
 */
export const ToolCallsSection: React.FC<ToolCallsSectionProps> = ({
  toolCalls,
  allMessages,
  messageId
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const headerRef = useRef<HTMLDivElement>(null);

  // Filter valid tool calls
  const validToolCalls = toolCalls.filter(tc =>
    tc.function.name && tc.function.name.trim() !== ''
  );

  if (validToolCalls.length === 0) {
    return null;
  }

  // Calculate overall execution status
  const sectionStatus = computeToolCallsSectionStatus(validToolCalls, allMessages);

  // Get summary text
  const summaryText = getToolCallsSummaryText(validToolCalls.length);

  // Find tool result
  const findToolResult = (toolCallId: string): MessageType | null => {
    return allMessages.find(msg =>
      msg.role === 'tool' && msg.tool_call_id === toolCallId
    ) || null;
  };

  /**
   * Handle expand/collapse click
   * Keep click position unchanged: expand downward when opening, collapse upward when closing
   */
  const handleToggle = useCallback(() => {
    if (!headerRef.current) {
      setIsExpanded(!isExpanded);
      return;
    }

    // Record header position relative to viewport before click
    const headerRect = headerRef.current.getBoundingClientRect();
    const headerTopBeforeToggle = headerRect.top;

    // Toggle expand state
    setIsExpanded(prev => !prev);

    // Use requestAnimationFrame to ensure DOM updates before adjusting scroll
    requestAnimationFrame(() => {
      if (!headerRef.current) return;

      // Get the updated header position
      const newHeaderRect = headerRef.current.getBoundingClientRect();
      const headerTopAfterToggle = newHeaderRect.top;

      // Calculate position difference
      const diff = headerTopAfterToggle - headerTopBeforeToggle;

      // If there's a difference, adjust scroll position to keep header at its original viewport position
      if (Math.abs(diff) > 1) {
        // Find the nearest scrollable container (chat-container-reverse)
        const scrollContainer = headerRef.current.closest('.chat-container-reverse');
        if (scrollContainer) {
          scrollContainer.scrollTop += diff;
        }
      }
    });
  }, [isExpanded]);

  return (
    <div className="tool-calls-section-new">
      {/* Header row */}
      <div
        ref={headerRef}
        className="tool-calls-row"
        onClick={handleToggle}
      >
        <div className="tool-calls-icon-col">
          <StatusIcon status={sectionStatus} />
          {/* Dashed connector line - only shown when expanded */}
          {isExpanded && <div className="tool-calls-dashed-line" />}
        </div>
        <div className="tool-calls-text-col">
          <span className="tool-calls-summary-text">{summaryText}</span>
          <ArrowIcon isExpanded={isExpanded} />
        </div>
      </div>

      {/* Expanded Tool Call list */}
      {isExpanded && validToolCalls.map((toolCall, index) => (
        <ToolCallItem
          key={`${messageId}_tool_${toolCall.id || index}`}
          toolCall={toolCall}
          toolResult={findToolResult(toolCall.id)}
          itemKey={`${messageId}_tool_${toolCall.id || index}`}
          isLast={index === validToolCalls.length - 1}
        />
      ))}
    </div>
  );
};

export default ToolCallsSection;
