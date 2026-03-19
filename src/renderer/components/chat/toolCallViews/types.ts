// src/renderer/components/chat/toolCallViews/types.ts
// Tool Call custom view type definitions

import { ToolCall, Message } from '../../../types/chatTypes';

/**
 * Tool Call custom view Props interface
 * All custom view components must implement this interface
 */
export interface ToolCallViewProps {
  /** Tool Call data */
  toolCall: ToolCall;
  /** Tool Result message (if completed) */
  toolResult: Message | null;
}

/**
 * Web Search result item
 */
export interface WebSearchResultItem {
  index: number;
  title: string;
  url: string;
  caption: string;
  site: string;
  query?: string;
}

/**
 * Web Search tool result
 */
export interface WebSearchToolResult {
  success: boolean;
  totalQueries: number;
  totalResults: number;
  results: WebSearchResultItem[];
  errors?: string[];
  timestamp: string;
}

/**
 * Web Search tool arguments
 */
export interface WebSearchToolArgs {
  description?: string;
  queries: string[];
  lang?: string;
  locale?: string;
  maxResults?: number;
}

/**
 * Web Fetch content result item
 */
export interface WebContentResult {
  url: string;
  title: string;
  content: string;
  error?: string;
  size: number;
  timestamp: string;
}

/**
 * Web Fetch tool result
 */
export interface WebFetchToolResult {
  success: boolean;
  totalUrls: number;
  successfulUrls: number;
  results: WebContentResult[];
  mergedContent: string;
  errors?: string[];
  timestamp: string;
}

/**
 * Web Fetch tool arguments
 */
export interface WebFetchToolArgs {
  description?: string;
  urls: string[];
  timeoutSeconds?: number;
  maxContentSize?: number;
}

/**
 * Execute Command tool arguments
 */
export interface ExecuteCommandToolArgs {
  description?: string;
  command: string;
  cwd?: string;
  args?: string[];
  timeoutSeconds?: number;
  shell?: 'powershell' | 'cmd' | 'bash' | 'sh' | 'zsh';
}

/**
 * Execute Command tool result
 */
export interface ExecuteCommandToolResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  cwd: string;
  shell: string;
  truncated?: boolean;
}

/**
 * Write File tool arguments
 */
export interface WriteFileToolArgs {
  filePath: string;
  content: string;
  description?: string;
  mode?: 'overwrite' | 'append' | 'prepend' | 'insert';
  encoding?: string;
  createIfNotExists?: boolean;
  createDirectories?: boolean;
  validateJson?: boolean;
  isBase64?: boolean;
  backupBeforeWrite?: boolean;
  insertPosition?: number;
  insertLine?: number;
  addNewlineBefore?: boolean;
  addNewlineAfter?: boolean;
  sectionId?: string;
  isLastChunk?: boolean;
}

/**
 * Write File tool result
 */
export interface WriteFileToolResult {
  success: boolean;
  filePath: string;
  bytesWritten: number;
  totalSize: number;
  mode: string;
  backupPath?: string;
  jsonValid?: boolean;
  chunkNumber?: number;
  sectionId?: string;
  isComplete?: boolean;
  error?: string;
}
