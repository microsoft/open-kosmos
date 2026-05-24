import { Message } from './chatTypes';

/**
 * ChatSession base interface (corresponds to main process ChatSession)
 */
export type SchedulerExecutionStatus = 'running' | 'completed' | 'failed';
export type ChatSessionReadStatus = 'read' | 'unread';

export interface ChatUnreadSummary {
  chatId: string;
  userUnreadCount: number;
  scheduledUnreadCount: number;
  updatedAt: string;
}

export interface BaseChatSession {
  /** ChatSession ID, format: chatSession_YYYYMMDDHHMMSS_<deviceid>_<random> */
  chatSession_id: string;
  /** Last updated time */
  last_updated: string;
  /** ChatSession title */
  title: string;
  /** ID of the scheduler job that created this session, if any */
  schedulerJobId?: string;
  /** Execution status for scheduled sessions */
  schedulerExecutionStatus?: SchedulerExecutionStatus;
  /** Start time for scheduled execution */
  schedulerStartedAt?: string;
  /** Completion time for scheduled execution */
  schedulerCompletedAt?: string;
  /** Error summary when scheduled execution fails */
  schedulerError?: string;
  /** Read status for unread indicator */
  readStatus?: ChatSessionReadStatus;
  /** Whether the session is explicitly starred by the user */
  starred?: boolean;
  /** Timestamp of the latest star action */
  starredAt?: string;
}

/**
 * Extended ChatSession interface
 * Adds chat history management capabilities
 */
export interface ChatSession extends BaseChatSession {
  chat_history: Message[];      // Full chat history for UI display
  context_history: Message[];   // Context history for LLM API (may be compressed)
}

/**
 * ChatSession creation parameters
 */
export interface CreateChatSessionParams {
  chatSession_id?: string;      // Optional, auto-generated if not provided
  title?: string;              // Optional, generated via LLM if not provided
  initialMessage?: Message;     // Optional, first message on initialization
  /** ID of the scheduler job that created this session, if any */
  schedulerJobId?: string;
  /** Initial read status, defaults to unread */
  readStatus?: ChatSessionReadStatus;
}

/**
 * ChatSession metadata update parameters
 */
export interface UpdateChatSessionMetadataParams {
  title?: string;
  last_updated?: string;
  schedulerExecutionStatus?: SchedulerExecutionStatus;
  schedulerStartedAt?: string;
  schedulerCompletedAt?: string;
  schedulerError?: string;
  readStatus?: ChatSessionReadStatus;
  starred?: boolean;
  starredAt?: string;
}

/**
 * ChatSession file update parameters
 */
export interface UpdateChatSessionFileParams {
  title?: string;
  chat_history?: Message[];
  context_history?: Message[];
  last_updated?: string;
}

/**
 * ChatSession operation result
 */
export interface ChatSessionOperationResult {
  success: boolean;
  session?: ChatSession;
  data?: any;
  error?: string;
}

/**
 * ChatSession list item (for UI display)
 */
export interface ChatSessionListItem {
  chatSession_id: string;
  title: string;
  last_updated: string;
  messageCount: number;
  readStatus?: ChatSessionReadStatus;
  starred?: boolean;
}

/**
 * ChatSession event types
 */
export type ChatSessionEvent =
  | 'session_created'
  | 'session_updated'
  | 'session_deleted'
  | 'session_switched'
  | 'title_updated';

/**
 * ChatSession event data
 */
export interface ChatSessionEventData {
  type: ChatSessionEvent;
  chatSession_id: string;
  session?: ChatSession;
  previousChatSession_id?: string;
}

/**
 * ChatSession manager configuration
 */
export interface ChatSessionManagerConfig {
  autoSave: boolean;
  autoGenerateTitle: boolean;
  maxSessions: number;
  compressionEnabled: boolean;
}
