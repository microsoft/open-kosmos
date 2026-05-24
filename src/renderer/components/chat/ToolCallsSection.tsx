// src/renderer/components/chat/ToolCallsSection.tsx
// Tool Calls Section component, renders the entire tool calls area and computes overall execution status

import React, { useState, useRef, useCallback } from 'react';
import { Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import { ToolCall, Message as MessageType, ToolMessage } from '@shared/types/chatTypes';
import { ToolCallItem } from './ToolCallItem';
import { getToolCallsSummaryText } from './toolCallDisplayConfig';
import { ToolCallExecutionStatus } from './toolCallViews/types';
import { ChatStatus, useMessages } from '@renderer/lib/chat/agentChatSessionCacheManager';

/**
 * Tool Calls overall execution status
 * - executing: all tools still executing (no results yet)
 * - partial: some tools completed, some still executing
 * - completed: all tools completed
 */
export type ToolCallsSectionStatus = 'executing' | 'partial' | 'completed' | 'interrupted';

export interface ToolCallsSectionProps {
  /** Tool Calls array */
  toolCalls: ToolCall[];
  /** Current chat session status, used to distinguish actively executing vs. historically interrupted */
  chatStatus?: ChatStatus;
  /** Source assistant message index for this group of tool calls, used to identify if superseded by later messages */
  sourceMessageIndex?: number;
  /** Message ID (used for generating unique keys) */
  messageId?: string;
}

/**
 * Compute the overall Tool Calls execution status
 */
const computeToolCallsSectionStatus = (
  toolCalls: ToolCall[],
  allMessages: MessageType[],
  chatStatus?: ToolCallsSectionProps['chatStatus'],
  sourceMessageIndex?: number
): ToolCallsSectionStatus => {
  // Filter valid tool calls
  const validToolCalls = toolCalls.filter(tc =>
    tc.id && tc.id.trim() !== '' &&
    tc.function.name && tc.function.name.trim() !== ''
  );

  if (validToolCalls.length === 0) {
    return 'completed';
  }

  // Count completed tool calls
  const completedCount = validToolCalls.filter(tc =>
    allMessages.some(msg =>
      msg.role === 'tool' && msg.tool_call_id === tc.id && msg.streamingComplete !== false
    )
  ).length;

  const hasSubsequentConversationMessage = typeof sourceMessageIndex === 'number'
    ? allMessages.some((msg, index) => index > sourceMessageIndex && msg.role !== 'tool')
    : false;

  if (completedCount === validToolCalls.length) {
    return 'completed';
  } else if (hasSubsequentConversationMessage) {
    return 'interrupted';
  } else if (!chatStatus || chatStatus === 'idle') {
    return 'interrupted';
  } else if (completedCount > 0) {
    return 'partial';
  } else {
    return 'executing';
  }
};

/**
 * Render the status icon
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
    case 'interrupted':
      return (
        <span className="tool-status-icon interrupted">
          <AlertCircle size={16} style={{ display: 'block' }} />
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
 * Renders the entire Tool Calls area including header status and all Tool Call items
 * Uses dashed lines to connect all icons
 */
export const ToolCallsSection: React.FC<ToolCallsSectionProps> = ({
  toolCalls,
  chatStatus,
  sourceMessageIndex,
  messageId
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const headerRef = useRef<HTMLDivElement>(null);
  const allMessages: MessageType[] = useMessages();

  // Filter valid tool calls
  const validToolCalls = toolCalls.filter(tc =>
    tc.function.name && tc.function.name.trim() !== ''
  );

  if (validToolCalls.length === 0) {
    return null;
  }

  // Compute overall execution status
  const sectionStatus = computeToolCallsSectionStatus(validToolCalls, allMessages, chatStatus, sourceMessageIndex);

  // Get summary text
  const summaryText = getToolCallsSummaryText(validToolCalls.length);

  // Find tool result
  const findToolResult = (tid: string): ToolMessage | null => {
    for (const m of allMessages) {
      if (m.role === 'tool' && m.tool_call_id === tid) return m;
    }
    return null;
  };

  /**
   * Handle expand/collapse click
   * Keep click position stable: expand downward, collapse upward
   */
  const handleToggle = useCallback(() => {
    if (!headerRef.current) {
      setIsExpanded(!isExpanded);
      return;
    }

    // Record header position relative to viewport before click
    const headerRect = headerRef.current.getBoundingClientRect();
    const headerTopBeforeToggle = headerRect.top;

    // Toggle expanded state
    setIsExpanded(prev => !prev);

    // Use requestAnimationFrame to ensure DOM update before adjusting scroll
    requestAnimationFrame(() => {
      if (!headerRef.current) return;

      // Get updated header position
      const newHeaderRect = headerRef.current.getBoundingClientRect();
      const headerTopAfterToggle = newHeaderRect.top;

      // Calculate position difference
      const diff = headerTopAfterToggle - headerTopBeforeToggle;

      // If there's a difference, adjust scroll to keep header at original viewport position
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
        (() => {
          const toolResult = findToolResult(toolCall.id);
          const executionStatus: ToolCallExecutionStatus = toolResult
            ? toolResult.streamingComplete === false
              ? 'executing'
              : 'completed'
            : sectionStatus === 'interrupted'
              ? 'interrupted'
              : 'executing';

          return (
            <ToolCallItem
              key={`${messageId}_tool_${toolCall.id || index}`}
              toolCall={toolCall}
              toolResult={toolResult}
              executionStatus={executionStatus}
              itemKey={`${messageId}_tool_${toolCall.id || index}`}
              isLast={index === validToolCalls.length - 1}
            />
          );
        })()
      ))}
    </div>
  );
};

export default ToolCallsSection;
