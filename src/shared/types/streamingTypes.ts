import { UserContentPart } from './chatTypes';

// Unified Streaming Chunk type definitions

/**
 * Unified Streaming Chunk format
 * Supports incremental transmission of Content, Tool Calls, and Tool Results
 */
export interface StreamingChunk {
  // Chunk metadata
  chunkId: string;                    // Unique identifier
  messageId: string;                  // Parent message ID
  chatId: string;                     // Parent Chat ID
  chatSessionId: string;              // Parent ChatSession ID, used for precise frontend filtering
  timestamp: number;                  // Timestamp

  // Chunk type: content | tool_call | tool_result | complete | user_message
  type: 'content' | 'tool_call' | 'tool_result' | 'complete' | 'user_message';

  // Content chunk - text content delta
  contentDelta?: {
    text: string;                     // Text delta fragment
  };

  // Tool call chunk - incrementally accumulated tool call
  toolCallDelta?: {
    index: number;                    // Tool call index in the array
    id?: string;                      // Tool call ID (sent on first occurrence)
    type?: 'function';                // Type (sent on first occurrence)
    function?: {
      name?: string;                  // Function name (sent on first occurrence)
      arguments?: string;             // Arguments delta fragment (JSON string)
    };
  };

  // Tool result chunk - tool execution result (transmitted in full)
  toolResult?: {
    tool_call_id: string;             // Corresponding tool call ID
    tool_name: string;                // Tool name
    content: string;                  // Execution result content
    isError: boolean;                 // Whether this is an error result
    isPartial?: boolean;              // Whether this is an in-progress partial result
  };

  // User message chunk - remote channel user message (transmitted in full)
  userMessage?: {
    id?: string;
    role: 'user';
    content: UserContentPart[];
    timestamp?: number;
  };

  // Complete chunk - message completion flag
  complete?: {
    messageId: string;                // Message ID
    hasToolCalls: boolean;            // Whether the message contains tool calls
  };
}

/**
 * Streaming state management interface
 */
export interface StreamingState {
  messageId: string;                  // Message ID
  role: 'assistant';                  // Role (streaming is only used for assistant)

  // Accumulated content
  accumulatedText: string;            // Accumulated text content

  // Accumulated tool calls
  accumulatedToolCalls: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;              // Accumulated complete JSON string
    };
  }>;

  // Completion status
  isComplete: boolean;                // Whether streaming is complete
}
