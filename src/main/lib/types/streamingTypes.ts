// src/main/lib/types/streamingTypes.ts
// Unified Streaming Chunk type definitions

/**
 * Unified Streaming Chunk format
 * Supports incremental transmission of Content, Tool Calls, and Tool Results
 */
export interface StreamingChunk {
  // Chunk metadata
  chunkId: string;                    // Unique identifier
  messageId: string;                  // Associated message ID
  chatId: string;                     // Associated ChatId
  chatSessionId: string;              // 🔥 New: associated ChatSessionId for precise frontend filtering
  timestamp: number;                  // Timestamp
  
  // Chunk type: content | tool_call | tool_result | complete
  type: 'content' | 'tool_call' | 'tool_result' | 'complete';
  
  // Content chunk - text content delta
  contentDelta?: {
    text: string;                     // Text delta fragment
  };
  
  // Tool call chunk - progressively accumulated tool calls
  toolCallDelta?: {
    index: number;                    // Tool call index in array
    id?: string;                      // Tool call ID (passed on first occurrence)
    type?: 'function';                // Type (passed on first occurrence)
    function?: {
      name?: string;                  // Function name (passed on first occurrence)
      arguments?: string;             // Arguments delta fragment (JSON string)
    };
  };
  
  // Tool result chunk - tool execution result (transmitted in full)
  toolResult?: {
    tool_call_id: string;             // Corresponding tool call ID
    tool_name: string;                // Tool name
    content: string;                  // Execution result content
    isError: boolean;                 // Whether this is an error result
  };
  
  // Complete chunk - message completion flag
  complete?: {
    messageId: string;                // Message ID
    hasToolCalls: boolean;            // Whether it contains tool calls
  };
}

/**
 * Frontend Streaming state management interface
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