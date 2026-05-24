// src/renderer/components/chat/toolCallViews/types.ts
// Type definitions for Tool Call custom views

import { ToolCall, Message } from '@shared/types/chatTypes';

export type ToolCallExecutionStatus = 'executing' | 'completed' | 'interrupted';

// Re-export tool call arg/result types from shared for convenience
export type {
  ExecuteCommandToolArgs, ExecuteCommandToolResult,
  WriteFileToolArgs, WriteFileToolResult,
  WebSearchToolArgs, WebSearchToolResult, WebSearchResultItem,
  WebFetchToolArgs, WebFetchToolResult, WebContentResult,
  CreateScheduleToolArgs, CreateScheduleToolResult,
  GetScheduleToolArgs, GetScheduleToolResult,
  UpdateScheduleToolArgs, UpdateScheduleToolResult,
  RunScheduleToolArgs, RunScheduleToolResult,
  CodingAgentToolArgs, CodingAgentToolResult,
} from '@shared/types/toolCallArgs';

/**
 * Props interface for Tool Call custom views
 * All custom view components must implement this interface
 */
export interface ToolCallViewProps {
  /** Tool Call data */
  toolCall: ToolCall;
  /** Tool Result message (if completed) */
  toolResult: Message | null;
  /** Execution state derived from the current chat session status */
  executionStatus: ToolCallExecutionStatus;
}
