/**
 * Sub-Agent Streaming Types
 *
 * Defines the chunk format for real-time streaming of sub-agent execution
 * to the frontend. Mirrors the main chat StreamingChunk pattern but scoped
 * to individual sub-agent tasks.
 */

export interface SubAgentStreamingChunk {
  /** Unique chunk identifier */
  chunkId: string;
  /** Message ID this chunk belongs to */
  messageId: string;
  /** Sub-agent task ID */
  taskId: string;
  /** Timestamp when chunk was emitted */
  timestamp: number;
  /** Chunk type */
  type: 'content' | 'tool_call' | 'tool_result' | 'complete' | 'turn_start';
  /** Content delta (for type: 'content') */
  contentDelta?: { text: string };
  /** Tool call delta (for type: 'tool_call') */
  toolCallDelta?: {
    index: number;
    id: string;
    function: { name: string; arguments: string };
  };
  /** Tool result (for type: 'tool_result') */
  toolResult?: {
    tool_call_id: string;
    tool_name: string;
    content: string;
    isError?: boolean;
  };
  /** Completion signal (for type: 'complete') */
  complete?: {
    messageId: string;
    hasToolCalls: boolean;
  };
}

/**
 * Sub-agent task status as seen from the frontend
 */
export type SubAgentTaskViewStatus = 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * Initial snapshot sent when frontend opens a task panel
 */
export interface SubAgentTaskSnapshot {
  taskId: string;
  subAgentName: string;
  status: SubAgentTaskViewStatus;
  startTime: number;
  endTime?: number;
  turnCount: number;
  model: string;
  /** Messages for rendering (chat_history) */
  messages: any[]; // Message type from chatTypes
}
