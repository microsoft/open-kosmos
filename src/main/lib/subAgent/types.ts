/**
 * Sub-Agent Runtime Type Definitions
 *
 * Unlike the persistence types (SubAgentConfig, etc.) in profile.ts,
 * this file defines interfaces and types used at Sub-Agent runtime.
 *
 * Persistence types located at: src/main/lib/userDataADO/types/profile.ts
 * Runtime types located at: this file
 */

import type { CancellationToken } from '../cancellation/CancellationToken';
import type {
  SubAgentConfig,
  SubAgentRuntimeState,
} from '../userDataADO/types/profile';

/**
 * Sub-Agent Runtime Entity
 *
 * Relationship with SubAgentConfig (persistence config):
 * - SubAgentConfig = static config stored in profile.json (similar to SkillConfig)
 * - SubAgent       = fully resolved runtime entity, including runtime info inherited from the parent
 *
 * Usage: In SubAgentManager.spawnSubAgent(), SubAgentConfig + parent runtime info
 *        are merged into a SubAgent instance and passed to SubAgentChat
 */
export interface SubAgent {
  /** Sub-agent config (from ProfileV2.sub_agents) */
  config: SubAgentConfig;
  /** Effective LLM model ID resolved at runtime: sub-agent override or parent Agent fallback */
  inheritedModel: string;
  /** Parent Agent's chatId (used to track parent-child relationships) */
  parentChatId: string;
  /** Parent Agent's chatSessionId */
  parentSessionId: string;
  /** Parent Agent's userAlias */
  userAlias: string;
  /** Resolved available MCP server connection status */
  resolvedMcpServers: Array<{
    name: string;
    connected: boolean;
    tools: string[];
    /** Whether inherited from the parent */
    inherited: boolean;
  }>;
  /** Resolved available Skills (actual content looked up from profile) */
  resolvedSkills: Array<{
    name: string;
    installed: boolean;
    /** Whether inherited from the parent */
    inherited: boolean;
  }>;
  /** Resolved Knowledge Base path (final value after inheritance merge) */
  resolvedKnowledgeBase?: string;
  /** Task ID assigned at runtime */
  taskId: string;
}

/**
 * Sub-agent step update event
 * Fired by SubAgentChat before/after tool execution and after text output,
 * passed to SubAgentManager via the onStepUpdate callback for assembly and IPC push.
 *
 * Semantic convention: the turn field indicates "the currently in-progress turn" (1-based),
 * which has a +1 offset from onTurnComplete's turn (the number of completed turns).
 * This is by design — step events occur during turn execution, while onTurnComplete fires after a turn ends.
 */
export interface SubAgentStepUpdate {
  /** Step type */
  type: 'tool_start' | 'tool_done' | 'tool_error' | 'text' | 'turn_start' | 'llm_streaming';
  /** Tool call ID (used for in-place replacement matching from tool_start → tool_done/tool_error) */
  toolCallId?: string;
  /** Tool name (only for tool_* types) */
  toolName?: string;
  /** Human-readable summary of tool arguments */
  toolArgsSummary?: string;
  /** Current turn (1-based) */
  turn: number;
  /** Tool execution duration (only for tool_done / tool_error, in ms) */
  durationMs?: number;
  /** Tool result length (only for tool_done, in characters) */
  toolResultLength?: number;
  /** Most recent LLM text output snippet (only for text type) */
  lastTextSnippet?: string;
  /** Current LLM streaming text being generated (only for llm_streaming type) */
  streamingText?: string;
}

/**
 * Sub-agent chat engine options
 * Passed to the SubAgentChat constructor, containing all information needed at runtime
 */
export interface SubAgentChatOptions {
  /** Runtime sub-agent entity (includes config + parent-inherited info) */
  subAgent: SubAgent;
  /** Task description */
  task: string;
  /** Cancellation token */
  cancellationToken: CancellationToken;
  /** Turn completion callback (turn = number of completed turns) */
  onTurnComplete?: (turn: number, lastMessage: string) => void;
  /** Step-level progress callback (fired before/after tool execution and after text output) */
  onStepUpdate?: (update: SubAgentStepUpdate) => void;
  /** Deliverables path (derived from parent session by SubAgentManager, used for file write guidance) */
  deliverablesPath?: string;
  /** Parent userAlias (used for sub-agent access to profile-scoped resources like SkillManager) */
  currentUserAlias: string;
  /** Optional tool name whitelist for ad-hoc agents — only these tools will be available (subset of parent's tools) */
  allowedToolNames?: Set<string>;
  /** Task ID assigned by SubAgentManager (used for draining pending messages from background queue) */
  taskId?: string;
  /** Streaming chunk callback — called when task is being watched by frontend */
  onStreamingChunk?: (chunk: import('@shared/types/subAgentStreamingTypes').SubAgentStreamingChunk) => void;
}

/**
 * Tool Execution Context
 *
 * Constructed by AgentChat during tool execution and passed to each tool implementation in BuiltinToolsManager.
 * Contains runtime information for the current session and sub-agent related helper methods.
 */
export interface ToolExecutionContext {
  /** Current chat session ID */
  chatSessionId: string;
  /** Current chat ID */
  chatId: string;
  /** Current user alias */
  userAlias: string;
  /** Cancellation token */
  cancellationToken: CancellationToken;
  /** Whether this is a sub-agent execution context (used for recursion prevention) */
  isSubAgent: boolean;
  /** Get sub-agent config by name (looks up from the current Agent's referenced sub-agents) */
  getSubAgentConfig(name: string): SubAgentConfig | undefined;
  /** Get parent conversation context summary (used for context sharing mode) */
  getParentContextSummary(): Promise<string>;
  /** Renderer WebContents reference for sending sub-agent progress IPC to the frontend (optional, only provided by main AgentChat) */
  eventSender?: Electron.WebContents;
  /** Currently executing toolCall ID (used for sub-agent correlationId association) */
  currentToolCallId?: string;
  /** Register a cancellation handler for the current tool execution and return a disposer */
  registerCancellationHandler?(handler: () => Promise<void> | void): { dispose(): void };
}
