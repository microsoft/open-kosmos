import { Message } from './chatTypes';

/**
 * ChatSession base interface (corresponds to main process ChatSession)
 */
export interface BaseChatSession {
  /** ChatSession ID, format: chatSession_YYYYMMDDHHMMSS */
  chatSession_id: string;
  /** Last updated time */
  last_updated: string;
  /** ChatSession title */
  title: string;
}

/**
 * Extended ChatSession interface
 * Adds chat history management
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
}

/**
 * ChatSession update parameters
 */
export interface UpdateChatSessionParams {
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
}

/**
 * ChatSession event type
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