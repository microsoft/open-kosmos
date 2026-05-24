/**
 * Sub-Agent Task Persistence Types
 *
 * Defines the file format for persisted sub-agent task records.
 * Stored at: {userData}/profiles/{userAlias}/sub-agent-tasks/{YYYY-MM}/{taskId}.json
 */

import type { Message } from '@shared/types/chatTypes';

export type SubAgentTaskStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export interface SubAgentTaskFile {
  /** Unique task identifier (e.g., sa_1716000000000_abc123) */
  taskId: string;
  /** Sub-agent name (pre-configured name or adhoc-xxx) */
  subAgentName: string;
  /** Parent chat session ID that spawned this task */
  parentSessionId: string;
  /** Parent chat ID */
  parentChatId: string;
  /** Unix timestamp (ms) when task started */
  startTime: number;
  /** Unix timestamp (ms) when task ended */
  endTime?: number;
  /** Current task status */
  status: SubAgentTaskStatus;
  /** LLM model used */
  model: string;
  /** Whether this was an ad-hoc agent */
  isAdhoc: boolean;
  /** Number of LLM turns completed */
  turnCount: number;
  /** Task title (LLM-generated or default fallback) */
  title?: string;
  /** Final result text (on success) */
  result?: string;
  /** Error message (on failure) */
  error?: string;
  /** Full uncompressed message history for UI rendering */
  chat_history: Message[];
  /** Compressed message history sent to LLM API */
  context_history: Message[];
}

export interface SubAgentTaskMetadata {
  taskId: string;
  subAgentName: string;
  parentSessionId: string;
  parentChatId: string;
  startTime: number;
  model: string;
  isAdhoc: boolean;
  /** Initial task description used to generate default title */
  taskDescription?: string;
}

/** Lightweight summary for listing tasks (no message histories) */
export interface SubAgentTaskSummary {
  taskId: string;
  subAgentName: string;
  status: SubAgentTaskStatus;
  startTime: number;
  endTime?: number;
  turnCount: number;
  model: string;
  title?: string;
}
