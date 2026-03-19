// src/renderer/components/chat/toolCallViews/index.ts
// Tool Call custom view exports and selection function

import React from 'react';
import { ToolCallViewProps } from './types';
import { WebSearchToolCallView } from './WebSearchToolCallView';
import { WebFetchToolCallView } from './WebFetchToolCallView';
import { ExecuteCommandToolCallView } from './ExecuteCommandToolCallView';
import { WriteFileToolCallView } from './WriteFileToolCallView';

export * from './types';
export { WebSearchToolCallView } from './WebSearchToolCallView';
export { WebFetchToolCallView } from './WebFetchToolCallView';
export { ExecuteCommandToolCallView } from './ExecuteCommandToolCallView';
export { WriteFileToolCallView } from './WriteFileToolCallView';

/**
 * Get the custom view component for a given tool name
 * Returns null if the tool has no custom view, uses default display
 */
export const getToolCallView = (
  toolName: string
): React.ComponentType<ToolCallViewProps> | null => {
  switch (toolName) {
    case 'bing_web_search':
    case 'google_web_search':
      return WebSearchToolCallView;

    case 'fetch_web_content':
      return WebFetchToolCallView;

    case 'execute_command':
      return ExecuteCommandToolCallView;

    case 'write_file':
    case 'create_file':
      return WriteFileToolCallView;

    // present_deliverables tool doesn't use custom view, handled specially by ToolCallsSection
    case 'present_deliverables':
      return null;

    // More custom views for other tools can be added in the future
    // case 'read_file':
    //   return FileReadToolCallView;

    default:
      return null;
  }
};

/**
 * Check if a tool has a custom view
 */
export const hasCustomView = (toolName: string): boolean => {
  return getToolCallView(toolName) !== null;
};
