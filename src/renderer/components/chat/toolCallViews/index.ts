// src/renderer/components/chat/toolCallViews/index.ts
// Tool Call custom view exports and selection functions

import React from 'react';
import { ToolCallViewProps } from './types';
import { WebSearchToolCallView } from './WebSearchToolCallView';
import { WebFetchToolCallView } from './WebFetchToolCallView';
import { ExecuteCommandToolCallView } from './ExecuteCommandToolCallView';
import { WriteFileToolCallView } from './WriteFileToolCallView';
import { CreateScheduleToolCallView } from './CreateScheduleToolCallView';
import { GetScheduleToolCallView } from './GetScheduleToolCallView';
import { UpdateScheduleToolCallView } from './UpdateScheduleToolCallView';
import { SubAgentToolCallView, ParallelSubAgentsToolCallView } from './SubAgentToolCallView';
import { CodingAgentToolCallView } from './CodingAgentToolCallView';

export * from './types';
export { WebSearchToolCallView } from './WebSearchToolCallView';
export { WebFetchToolCallView } from './WebFetchToolCallView';
export { ExecuteCommandToolCallView } from './ExecuteCommandToolCallView';
export { WriteFileToolCallView } from './WriteFileToolCallView';
export { CreateScheduleToolCallView } from './CreateScheduleToolCallView';
export { GetScheduleToolCallView } from './GetScheduleToolCallView';
export { UpdateScheduleToolCallView } from './UpdateScheduleToolCallView';
export { SubAgentToolCallView, ParallelSubAgentsToolCallView } from './SubAgentToolCallView';
export { CodingAgentToolCallView } from './CodingAgentToolCallView';

/**
 * Get the custom view component for a given tool name.
 * Returns null if the tool has no custom view, using the default display.
 */
export const getToolCallView = (
  toolName: string
): React.ComponentType<ToolCallViewProps> | null => {
  switch (toolName) {
    case 'bing_web_search':
      return WebSearchToolCallView;

    case 'fetch_web_content':
      return WebFetchToolCallView;

    case 'execute_command':
      return ExecuteCommandToolCallView;

    case 'write_file':
    case 'create_file':
      return WriteFileToolCallView;

    case 'create_schedule':
      return CreateScheduleToolCallView;

    case 'get_schedule':
      return GetScheduleToolCallView;

    case 'update_schedule':
      return UpdateScheduleToolCallView;

    // present_deliverables tool does not use a custom view; handled specially by ToolCallsSection
    case 'present_deliverables':
      return null;

    // Sub-Agent tool views
    case 'sub_agent':
    case 'spawn_subagent':
    case 'spawn_adhoc_subagent':
      return SubAgentToolCallView;

    case 'spawn_subagents':
    case 'spawn_adhoc_subagents':
      return ParallelSubAgentsToolCallView;

    case 'coding_agent':
      return CodingAgentToolCallView;

    // More custom tool views can be added in the future
    // case 'read_file':
    //   return FileReadToolCallView;

    default:
      return null;
  }
};

/**
 * Check if a tool has a custom view.
 */
export const hasCustomView = (toolName: string): boolean => {
  return getToolCallView(toolName) !== null;
};
