/**
 * SubAgentChat — Lightweight sub-agent conversation engine
 *
 * Key differences from AgentChat (see ADR-1 appendix):
 * - Uses streaming fetch (same SSE parsing as main Agent, but does not send chunks to frontend)
 * - No session persistence (results are recorded by the parent AgentChat)
 * - Hybrid compact context (compresses early messages via haiku LLM summary when message count or token threshold exceeded; never truncates/discards tool results)
 * - Shares parent CancellationToken (parent cancel → sub-agent auto-terminates)
 * - Has follow-up guidance: when LLM returns intent text instead of tool calls, automatically prompts it to execute
 *
 * File location: src/main/lib/subAgent/subAgentChat.ts
 */

import type { CancellationToken } from '../cancellation/CancellationToken';
import type { Message } from '@shared/types/chatTypes';
import { MessageHelper } from '@shared/types/chatTypes';
import { getModelCapabilities } from '../llm/ghcModelsManager';
import type { SubAgentChatOptions } from './types';
import { buildSubAgentSystemPrompt, buildWorkspaceAndSkillsInfo } from './subAgentPromptBuilder';
import type { SubAgentConfig } from '../userDataADO/types/profile';
import { createConsoleLogger } from '../unifiedLogger';
import { normalizeToolCalls } from '../chat/agentChatUtilities';
import { TokenCounter } from "../token/TokenCounter";
import { mcpClientManager } from "../mcpRuntime/mcpClientManager";
import { SubAgentTaskStore } from './subAgentTaskStore';
import type { SubAgentStreamingChunk } from '@shared/types/subAgentStreamingTypes';
import {
  repairToolCallArguments,
  tryRepairTruncatedJson,
  extractFirstJson,
  detectTruncatedToolCalls,
  isMissingCriticalFields,
} from './subAgentToolCallRepair';
import { summarizeToolArgs } from './subAgentToolExecutor';
import { processSSELine } from './subAgentLLMClient';
import { SubAgentContextCompactor } from './subAgentContextCompactor';
import { SubAgentToolExecutor } from './subAgentToolExecutor';
import { SubAgentLLMClient } from './subAgentLLMClient';
import type { LLMResponse } from './subAgentLLMClient';

// Lazy-init logger
let logger: any;
(async () => {
  logger = await createConsoleLogger();
})();

function getLogger() {
  return logger || console;
}

/**
 * Truncate text to specified line count and character limit
 * Used for concise text summaries in UI display
 */
export function truncateToLines(text: string, maxLines: number, maxChars: number): string {
  if (!text) return '';
  const lines = text.split('\n').filter(l => l.trim());
  const truncatedLines = lines.slice(0, maxLines);
  let result = truncatedLines.join('\n');
  if (result.length > maxChars) {
    result = result.substring(0, maxChars - 3) + '...';
  } else if (lines.length > maxLines) {
    result += '...';
  }
  return result;
}

/**
 * Sub-agent conversation engine
 */
/** Compact context configuration constants */
const COMPACT_CONTEXT_CONFIG = {
  /** Token usage ratio threshold (60%) for triggering compact context — more aggressive to ensure sub-agent doesn't slow down from oversized context */
  COMPRESSION_THRESHOLD: 0.60,
  /** Fallback value when model context window size cannot be retrieved */
  FALLBACK_CONTEXT_WINDOW: 128000,
  /** Message count threshold for triggering compression — when exceeded, early messages are distilled into a summary by LLM */
  MSG_COUNT_COMPRESS_THRESHOLD: 20,
  /** When message count compression triggers, compress the first N messages into a single summary */
  MSG_COUNT_COMPRESS_BATCH: 15,
  /** Maximum token count for message compression summary */
  MSG_COUNT_COMPRESS_MAX_TOKENS: 3000,
  /** Message compression timeout (ms) */
  MSG_COUNT_COMPRESS_TIMEOUT_MS: 20000,
} as const;

/**
 * Tool result LLM smart compression configuration
 *
 * When a tool result exceeds SUMMARIZE_THRESHOLD characters, uses a fast and cheap LLM (claude-haiku-4.5)
 * to distill key information, compressing 20KB of web content into a 2-3KB structured summary.
 * MAX_TOOL_RESULT_CHARS serves as a safety net (fallback to hard truncation when LLM compression fails).
 */
const TOOL_RESULT_SUMMARIZE_CONFIG = {
  /** Character threshold for triggering LLM compression — tool results exceeding this will be distilled */
  SUMMARIZE_THRESHOLD: 15000,
  /** Model used for LLM compression (fast + cheap) */
  SUMMARIZE_MODEL: 'claude-haiku-4.5' as const,
  /** Maximum token count for summary output */
  SUMMARIZE_MAX_TOKENS: 2000,
  /** LLM compression timeout (ms) — falls back to hard truncation on timeout */
  SUMMARIZE_TIMEOUT_MS: 15000,
  /** Hard truncation safety net (characters) — fallback when LLM compression fails */
  MAX_TOOL_RESULT_CHARS: 50000,
} as const;

export class SubAgentChat {
  private contextHistory: Message[] = [];
  /** Full uncompressed history for UI rendering (never compressed) */
  private chatHistory: Message[] = [];
  private turnCount: number = 0;
  private disposed: boolean = false;
  /** Model context window size (token count), cached on first call */
  private contextWindowSize: number = 0;
  /** File paths created/written during sub-agent execution (deduplicated, for attaching deliverables info to results) */
  private deliverables: string[] = [];
  /** Context compaction helper — holds a reference to contextHistory and mutates it in-place */
  private compactor!: SubAgentContextCompactor;
  /** Tool execution helper */
  private toolExecutor!: SubAgentToolExecutor;
  /** LLM transport client — handles API calls, SSE parsing, and message formatting */
  private llmClient!: SubAgentLLMClient;

  constructor(private options: SubAgentChatOptions) {
    // Get model context window size
    const modelId = this.options.subAgent.inheritedModel;
    const capabilities = getModelCapabilities(modelId);
    this.contextWindowSize = capabilities?.maxContextLength || COMPACT_CONTEXT_CONFIG.FALLBACK_CONTEXT_WINDOW;
    this.compactor = new SubAgentContextCompactor(
      this.contextHistory,
      this.options,
      this.contextWindowSize,
      new TokenCounter({ enableCache: true })
    );
    this.toolExecutor = new SubAgentToolExecutor(
      this.options,
      this.deliverables,
      (content, toolName, len) => this.compactor.compressToolResult(content, toolName, len),
    );
    this.llmClient = new SubAgentLLMClient(
      this.options,
      () => this.turnCount,
      (messages) => this.compactor.sanitizeOrphanedToolResults(messages),
      () => this.createAbortSignal(),
    );
  }

  // ─── Dual history helpers ───

  /**
   * Append a message to both histories. Use target='context_only' for synthetic messages
   * that should not appear in the UI display history.
   */
  private appendToHistory(msg: Message, target: 'both' | 'context_only' = 'both'): void {
    this.contextHistory.push(msg);
    if (target === 'both') {
      this.chatHistory.push(msg);
    }
    // Persist to TaskStore
    if (this.options.taskId) {
      SubAgentTaskStore.getInstance().appendMessage(this.options.taskId, msg, target);
    }
  }

  /**
   * Append multiple messages to both histories.
   */
  private appendManyToHistory(msgs: Message[], target: 'both' | 'context_only' = 'both'): void {
    this.contextHistory.push(...msgs);
    if (target === 'both') {
      this.chatHistory.push(...msgs);
    }
    // Persist to TaskStore
    if (this.options.taskId) {
      SubAgentTaskStore.getInstance().appendMessages(this.options.taskId, msgs, target);
    }
    // Notify frontend watchers that new messages are available
    if (target === 'both' && msgs.length > 0) {
      this.emitStreamingChunk({
        type: 'tool_result',
        messageId: msgs[msgs.length - 1].id || `msg_${Date.now()}`,
        toolResult: {
          tool_call_id: '',
          tool_name: 'batch',
          content: '',
        },
      });
    }
  }

  /** Get full uncompressed history for UI rendering */
  public getChatHistory(): Message[] {
    return this.chatHistory;
  }

  /** Get compressed history (sent to LLM API) */
  public getContextHistory(): Message[] {
    return this.contextHistory;
  }

  /** Emit a streaming chunk via the callback (if configured) */
  private emitStreamingChunk(chunk: Omit<SubAgentStreamingChunk, 'chunkId' | 'timestamp' | 'taskId'>): void {
    if (!this.options.onStreamingChunk || !this.options.taskId) return;
    this.options.onStreamingChunk({
      ...chunk,
      chunkId: `chunk_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      taskId: this.options.taskId,
      timestamp: Date.now(),
    });
  }

  /**
   * Run the sub-agent conversation loop
   *
   * Design reference: AgentChat.startChat() while(requiresFollowUp) loop
   * Key improvements (compared to previous version):
   * - Uses streaming mode to call LLM (more reliable finish_reason, supports mid-stream cancellation)
   * - Adds follow-up guidance: when LLM returns intent text without calling tools, auto-prompts execution
   * - Uses consecutiveTextOnlyRounds counter to prevent infinite follow-ups
   */
  public async run(): Promise<string> {
    // 1. Build initial system prompt
    const systemMessages = buildSubAgentSystemPrompt(this.options);

    // 2. Build initial user message
    this.appendToHistory(
      MessageHelper.createTextMessage(this.options.task, 'user')
    );

    // 3. Get available tools list (fetched once, immutable during sub-agent lifecycle)
    const availableTools = await this.getAvailableTools();
    const hasTools = availableTools.length > 0;

    // 4. Conversation loop
    let requiresFollowUp = true;
    let consecutiveTextOnlyRounds = 0; // Track consecutive text-only response count

    while (requiresFollowUp && this.turnCount < 200) {
      // Check cancellation

      // Step update: turn start
      this.options.onStepUpdate?.({
        type: 'turn_start',
        turn: this.turnCount + 1,
      });

      // Compact context: check and compress context before each LLM call
      await this.compactor.compactContextIfNeeded(systemMessages, availableTools);

      // Drain pending messages from parent (for background sub-agents receiving mid-turn instructions)
      await this.drainPendingMessages();

      // Call LLM (streaming mode, but does not send chunks to frontend)
      getLogger().info?.(
        `[SubAgentChat] Turn ${this.turnCount + 1}: calling LLM ` +
        `(model=${this.options.subAgent.inheritedModel}, contextMsgs=${this.contextHistory.length}, ` +
        `tools=${availableTools.length})`,
        'run'
      );
      let response: LLMResponse;
      try {
        response = await this.callLLM(systemMessages, this.contextHistory, availableTools);
      } catch (llmError) {
        // If 400 error related to tool_call format, try sanitizing tool_calls in context history and retry
        const errMsg = llmError instanceof Error ? llmError.message : String(llmError);
        if (errMsg.includes('400') && errMsg.includes('invalid_tool_call_format')) {
          getLogger().warn?.(
            `[SubAgentChat] LLM returned 400 invalid_tool_call_format. ` +
            `Attempting to sanitize tool_calls in context history and retry...`,
            'run'
          );
          this.sanitizeContextHistoryToolCalls();
          response = await this.callLLM(systemMessages, this.contextHistory, availableTools);
        } else {
          throw llmError;
        }
      }

      // Normalize tool call arguments (aligned with main AgentChat, preventing invalid JSON arguments)
      if (response.hasToolCalls && response.toolCalls.length > 0) {
        const normalizedToolCalls = normalizeToolCalls(response.toolCalls);
        if (normalizedToolCalls) {
          // Check if there were changes and log them
          for (let i = 0; i < normalizedToolCalls.length; i++) {
            const original = response.toolCalls[i];
            const normalized = normalizedToolCalls[i];
            if (original && normalized &&
                original.function?.arguments !== normalized.function?.arguments) {
              getLogger().warn?.(
                `[SubAgentChat] Tool call arguments normalized for '${normalized.function?.name}': ` +
                `original="${String(original.function?.arguments).substring(0, 200)}" → ` +
                `normalized="${String(normalized.function?.arguments).substring(0, 200)}"`,
                'run'
              );
            }
          }
          response.toolCalls = normalizedToolCalls;
          // Sync update tool_calls in assistantMessage
          response.assistantMessage.tool_calls = normalizedToolCalls;
        }
      }

      getLogger().info?.(
        `[SubAgentChat] Turn ${this.turnCount + 1}: LLM response received ` +
        `(hasToolCalls=${response.hasToolCalls}, toolCount=${response.toolCalls.length}, ` +
        `finishReason=${response.finishReason}, textLen=${response.textContent.length})`,
        'run'
      );

      // Add assistant message to context
      this.appendToHistory(response.assistantMessage);

      // Emit streaming chunk for complete assistant message
      this.emitStreamingChunk({
        type: 'complete',
        messageId: response.assistantMessage.id || `msg_${Date.now()}`,
        complete: {
          messageId: response.assistantMessage.id || `msg_${Date.now()}`,
          hasToolCalls: response.hasToolCalls,
        },
      });

      // Handle tool calls
      if (response.hasToolCalls) {
        // Detect truncated tool calls when finish_reason=length
        if (response.finishReason === 'length') {
          const truncatedToolCalls = detectTruncatedToolCalls(response.toolCalls);
          if (truncatedToolCalls.length > 0) {
            getLogger().warn?.(
              `[SubAgentChat] Detected ${truncatedToolCalls.length} truncated tool call(s) ` +
              `(finish_reason=length). Tool(s): ${truncatedToolCalls.map(tc => tc.function?.name).join(', ')}. ` +
              `Skipping execution and asking LLM to retry with shorter content.`,
              'run'
            );
            // Do not execute truncated tool calls — return error message for LLM to retry
            const errorResults = truncatedToolCalls.map(tc =>
              MessageHelper.createToolMessage(
                `ERROR: Your tool call arguments were truncated because the response exceeded the maximum output token limit. ` +
                `The '${tc.function?.name}' call is missing data. ` +
                `Please retry with SHORTER content. If writing a file, split it into multiple smaller write_file calls ` +
                `or significantly reduce the content length.`,
                tc.id,
                tc.function?.name || 'unknown',
              )
            );
            // Execute non-truncated tool calls normally
            const validToolCalls = response.toolCalls.filter(
              tc => !truncatedToolCalls.includes(tc)
            );
            let validResults: Message[] = [];
            if (validToolCalls.length > 0) {
              validResults = await this.toolExecutor.executeToolCalls(validToolCalls, this.turnCount);
            }
            this.appendManyToHistory([...validResults, ...errorResults]);
            consecutiveTextOnlyRounds = 0;
            requiresFollowUp = true;
          } else {
            // finish_reason=length but tool call arguments are complete (text part was truncated)
            const toolResults = await this.toolExecutor.executeToolCalls(response.toolCalls, this.turnCount);
            this.appendManyToHistory(toolResults);
            consecutiveTextOnlyRounds = 0;
            requiresFollowUp = true;
          }
        } else {
          const toolResults = await this.toolExecutor.executeToolCalls(response.toolCalls, this.turnCount);
          this.appendManyToHistory(toolResults);
          consecutiveTextOnlyRounds = 0;
          requiresFollowUp = true;
        }
      } else {
        consecutiveTextOnlyRounds++;

        // Determine whether to continue the loop (follow-up guidance mechanism)
        if (this.shouldContinueAfterTextResponse(response, consecutiveTextOnlyRounds, hasTools)) {
          // LLM returned intent text without calling tools -> append guidance prompt to trigger execution
          getLogger().info?.(
            `[SubAgentChat] Text-only response detected (round ${consecutiveTextOnlyRounds}), ` +
            `injecting follow-up prompt to guide tool usage`,
            'run'
          );
          this.appendToHistory(MessageHelper.createTextMessage(
            'Please proceed with executing the task using the available tools. ' +
            'Do not just describe what you plan to do — actually use the tools to accomplish it now.',
            'user'
          ));
          requiresFollowUp = true;
        } else {
          requiresFollowUp = false;
        }
      }

      // Step update: text output (truncated to max 4 lines, 500 characters)
      if (response.textContent) {
        this.options.onStepUpdate?.({
          type: 'text',
          turn: this.turnCount + 1,
          lastTextSnippet: truncateToLines(response.textContent, 4, 500),
        });
      }

      this.turnCount++;
      if (this.options.taskId) {
        SubAgentTaskStore.getInstance().incrementTurnCount(this.options.taskId);
      }
      this.options.onTurnComplete?.(this.turnCount, response.textContent);
    }

    // 5. Return final text result
    return this.extractFinalResult();
  }

  /**
   * Determine whether to continue the loop after a text-only response (follow-up guidance mechanism)
   *
   * Rules:
   * 1. finish_reason == 'length' -> token truncation, should continue
   * 2. First text-only round + tools available + text looks like "plan/intent" -> follow-up prompt
   * 3. 2+ consecutive text-only rounds -> treat as LLM genuinely finished, exit
   * 4. No tools available -> exit directly (plain text is the final result)
   */
  private shouldContinueAfterTextResponse(
    response: LLMResponse,
    consecutiveTextOnlyRounds: number,
    hasTools: boolean
  ): boolean {
    // finish_reason is length, meaning token truncation, need to continue
    if (response.finishReason === 'length') {
      getLogger().info?.('[SubAgentChat] finish_reason=length, continuing loop', 'shouldContinueAfterTextResponse');
      return true;
    }

    // No tools available, plain text is the final result
    if (!hasTools) return false;

    // 2+ consecutive text-only rounds, treat as LLM genuinely not wanting to call tools
    if (consecutiveTextOnlyRounds >= 2) return false;

    // First round: detect if text is "intent expression" rather than "final result"
    if (consecutiveTextOnlyRounds === 1) {
      return this.looksLikeIntentNotResult(response.textContent);
    }

    return false;
  }

  /**
   * Simple heuristic detection: determine if text looks like "intent expression" rather than "final result"
   *
   * Scenario: LLM returns something like "I'll conduct a deep research... Let me gather information"
   * This is plan/intent text, should follow up to guide actual tool call execution
   */
  private looksLikeIntentNotResult(text: string): boolean {
    if (!text || text.length < 10) return false;

    const intentPatterns = [
      /\blet me\b/i,
      /\bi['']ll\b/i,
      /\bi will\b/i,
      /\blet['']s\b/i,
      /\bfirst[,\s]/i,
      /\bstep\s*1\b/i,
      /\bi['']m going to\b/i,
      /\bi['']m about to\b/i,
      /\bgather\b.*\binformation\b/i,
      /\bsearch\b.*\bfor\b/i,
      /\bI need to\b/i,
      /\bI should\b/i,
      /\bI can\b.*\bby\b/i,
      /\bhere['']s my plan\b/i,
      /\bmy approach\b/i,
    ];

    const isIntent = intentPatterns.some(p => p.test(text));
    if (isIntent) {
      getLogger().info?.(
        `[SubAgentChat] Detected intent text (not a final result): "${text.substring(0, 100)}..."`,
        'looksLikeIntentNotResult'
      );
    }
    return isIntent;
  }

  /**
   * Iterate contextHistory and repair arguments fields of tool_calls in all assistant messages
   *
   * Called as a pre-retry fix when LLM API returns 400 invalid_tool_call_format.
   * Performs JSON validation and repair on each tool_call's arguments.
   */
  private sanitizeContextHistoryToolCalls(): void {
    let sanitizedCount = 0;
    for (let i = 0; i < this.contextHistory.length; i++) {
      const msg = this.contextHistory[i];
      if (msg.role !== 'assistant' || !msg.tool_calls || msg.tool_calls.length === 0) continue;

      const sanitizedToolCalls = msg.tool_calls.map((tc: any) => {
        if (tc?.function?.arguments == null) return tc;
        try {
          JSON.parse(tc.function.arguments);
          return tc; // Already valid JSON
        } catch {
          // Attempt repair
          const repaired = repairToolCallArguments(tc);
          sanitizedCount++;
          return repaired;
        }
      });

      this.contextHistory[i] = { ...msg, tool_calls: sanitizedToolCalls };
    }
    getLogger().info?.(
      `[SubAgentChat] sanitizeContextHistoryToolCalls: repaired ${sanitizedCount} tool_call argument(s) ` +
      `across ${this.contextHistory.length} messages`,
      'sanitizeContextHistoryToolCalls'
    );
  }

  /**
   * Create an AbortSignal linked to the CancellationToken
   */
  private createAbortSignal(): AbortSignal {
    const abortController = new AbortController();

    if (this.options.cancellationToken.isCancellationRequested) {
      abortController.abort();
    } else {
      this.options.cancellationToken.onCancellationRequested(() => {
        abortController.abort();
      });
    }

    return abortController.signal;
  }

  /**
   * Get the sub-agent's available tools list
   *
   * Uses MCPClientManager.getToolsForSubAgent() method
   * which has built-in recursive spawn prevention (removes spawn_subagent / spawn_subagents)
   */
  private async getAvailableTools(): Promise<any[]> {
    try {
      const subAgent = this.options.subAgent;
      const config = subAgent.config;

      // Use resolved MCP servers (includes inherited from parent) instead of raw config
      const mcpServersForTools = subAgent.resolvedMcpServers.length > 0
        ? subAgent.resolvedMcpServers.map(s => ({ name: s.name, tools: s.tools }))
        : (config.mcp_servers || []);

      return mcpClientManager.getToolsForSubAgent(
        mcpServersForTools,
        config.builtin_tools,
        config.disallow_builtin_tools,
        this.options.allowedToolNames,
      );
    } catch (error) {
      getLogger().error?.(
        `[SubAgentChat] Failed to get available tools: ${error instanceof Error ? error.message : String(error)}`
      );
      return [];
    }
  }

  /**
   * Extract final result text
   */
  private extractFinalResult(): string {
    this.syncDeliverables();
    // Reverse search for the last assistant message
    let resultText = '';
    for (let i = this.contextHistory.length - 1; i >= 0; i--) {
      const msg = this.contextHistory[i];
      if (msg.role === 'assistant' && msg.content) {
        const text = Array.isArray(msg.content)
          ? msg.content
              .filter((p: any) => p.type === 'text')
              .map((p: any) => p.text)
              .join('')
          : String(msg.content);

        if (text) {
          const truncationWarning = this.turnCount >= 200
            ? `\n\n⚠️ Sub-agent reached safety turn limit (200). Result may be incomplete.`
            : '';
          resultText = text + truncationWarning;
          break;
        }
      }
    }

    if (!resultText) {
      resultText = this.turnCount >= 200
        ? `Sub-agent reached safety turn limit (200) without producing a text result.`
        : 'Sub-agent completed without producing a text result.';
    }

    // Append deliverables info (programmatic tracking, ensures parent Agent can perceive files created by sub-agent)
    return resultText + this.toolExecutor.formatDeliverablesSection();
  }

  /** Get current conversation turn count */
  public getTurnCount(): number {
    return this.turnCount;
  }

  /**
   * Drain pending messages from parent agent (for background sub-agents).
   * Messages are injected as user messages into contextHistory.
   */
  private async drainPendingMessages(): Promise<void> {
    const taskId = this.options.taskId;
    if (!taskId) return;

    try {
      const { SubAgentManager } = await import('./subAgentManager');
      const manager = SubAgentManager.getInstance();
      const task = manager.getBackgroundTask(taskId);
      if (!task?.pendingMessages?.length) return;

      const messages = task.pendingMessages.splice(0); // atomically drain
      for (const msg of messages) {
        this.appendToHistory(
          MessageHelper.createTextMessage(
            `[Parent instruction]: ${msg}`,
            'user',
          )
        );
      }
      getLogger().info?.(
        `[SubAgentChat] Drained ${messages.length} pending messages from parent`,
        'drainPendingMessages'
      );
    } catch {
      // Non-critical — don't break the chat loop
    }
  }

  /**
   * Extract partial result from context history (for timeout/cancellation recovery).
   * Scans backwards for the last assistant message with text content.
   * Returns undefined if no usable text found. Capped at 10K chars.
   */
  public extractPartialResult(): string | undefined {
    for (let i = this.contextHistory.length - 1; i >= 0; i--) {
      const msg = this.contextHistory[i];
      if (msg.role === 'assistant' && msg.content) {
        const text = Array.isArray(msg.content)
          ? msg.content
              .filter((p: any) => p.type === 'text')
              .map((p: any) => p.text)
              .join('')
          : String(msg.content);
        if (text.trim().length > 0) {
          return text.slice(0, 10000);
        }
      }
    }
    return undefined;
  }

  // ─── Test-visible wrappers (delegate to extracted modules) ───

  /** @internal for tests */
  private buildSystemPrompt(): Message[] {
    return buildSubAgentSystemPrompt(this.options);
  }

  /** @internal for tests */
  private buildWorkspaceAndSkillsInfo(config: SubAgentConfig): string {
    return buildWorkspaceAndSkillsInfo(this.options, config);
  }

  /** @internal for tests */
  private getDeliverablesPath(): string | null {
    return this.options.deliverablesPath || null;
  }

  /**
   * Sync compactor's contextHistory reference to this.contextHistory in-place.
   * Needed when tests reassign (chat as any).contextHistory directly.
   */
  private syncCompactorHistory(): void {
    const compactorHist: Message[] = (this.compactor as any).contextHistory;
    if (compactorHist !== this.contextHistory) {
      compactorHist.length = 0;
      compactorHist.push(...this.contextHistory);
    }
  }

  /** @internal for tests — delegates to compactor */
  private async compactContextIfNeeded(systemMessages: Message[], tools: any[]): Promise<void> {
    this.syncCompactorHistory();
    // Sync contextWindowSize to compactor (tests may override it directly)
    (this.compactor as any).contextWindowSize = this.contextWindowSize;
    // Patch compactor's compressEarlyMessages to route through our wrapper,
    // so vi.spyOn(chat, 'compressEarlyMessages') works in tests.
    const origFn = (this.compactor as any).compressEarlyMessages.bind(this.compactor);
    (this.compactor as any).compressEarlyMessages = (batchSize: number) => this.compressEarlyMessages(batchSize);
    try {
      return await this.compactor.compactContextIfNeeded(systemMessages, tools);
    } finally {
      (this.compactor as any).compressEarlyMessages = origFn;
    }
  }

  /** @internal for tests — delegates to compactor (using reflection since it's private) */
  private async compressEarlyMessages(batchSize: number): Promise<void> {
    this.syncCompactorHistory();
    await (this.compactor as any).compressEarlyMessages(batchSize);
    // Sync back: compactor may have mutated its array
    const compactorHist: Message[] = (this.compactor as any).contextHistory;
    if (compactorHist !== this.contextHistory) {
      this.contextHistory.length = 0;
      this.contextHistory.push(...compactorHist);
    }
  }

  /** @internal for tests — delegates to compactor */
  private async compressToolResult(content: string, toolName: string, contentLength: number): Promise<string> {
    return this.compactor.compressToolResult(content, toolName, contentLength);
  }

  /** @internal for tests — delegates to compactor */
  private estimateMessagesTokens(tokenCounter: any, messages: Message[]): number {
    return (this.compactor as any).estimateMessagesTokens(tokenCounter, messages);
  }

  /** @internal for tests — delegates to compactor */
  private estimateToolsTokens(tokenCounter: any, tools: any[]): number {
    return (this.compactor as any).estimateToolsTokens(tokenCounter, tools);
  }

  /** @internal for tests — delegates to compactor */
  private getMessageText(msg: any): string {
    return (this.compactor as any).getMessageText(msg);
  }

  /** @internal for tests — delegates to compactor */
  private adjustBatchBoundaryForToolPairs(batchSize: number): number {
    this.syncCompactorHistory();
    return (this.compactor as any).adjustBatchBoundaryForToolPairs(batchSize);
  }

  /** @internal for tests — delegates to compactor */
  private sanitizeOrphanedToolResults(messages: Message[]): Message[] {
    return this.compactor.sanitizeOrphanedToolResults(messages);
  }

  /** @internal for tests — delegates to toolExecutor */
  private trackDeliverables(toolName: string, args: Record<string, unknown>): void {
    this.toolExecutor.trackDeliverables(toolName, args);
  }

  /** @internal for tests — delegates to toolExecutor */
  private formatDeliverablesSection(): string {
    this.syncDeliverables();
    return this.toolExecutor.formatDeliverablesSection();
  }

  /**
   * Sync toolExecutor's deliverables reference to this.deliverables in-place.
   * Needed when tests reassign (chat as any).deliverables directly.
   */
  private syncDeliverables(): void {
    const execDels: string[] = (this.toolExecutor as any).deliverables;
    if (execDels !== this.deliverables) {
      execDels.length = 0;
      execDels.push(...this.deliverables);
    }
  }

  /** @internal for tests — delegates to toolExecutor */
  private async executeToolCalls(toolCalls: any[]): Promise<Message[]> {
    return this.toolExecutor.executeToolCalls(toolCalls, this.turnCount);
  }

  /** @internal for tests — delegates to llmClient */
  private async callLLM(
    systemMessages: Message[],
    contextHistory: Message[],
    tools: any[]
  ): Promise<LLMResponse> {
    return this.llmClient.callLLM(systemMessages, contextHistory, tools);
  }

  /** @internal for tests — delegates to llmClient */
  private formatMessageForAPI(msg: Message): Record<string, unknown> {
    return this.llmClient.formatMessageForAPI(msg);
  }

  /** @internal for tests — delegates to llmClient */
  private async parseStreamingResponse(response: Response, endpoint: string): Promise<LLMResponse> {
    return this.llmClient.parseStreamingResponse(response, endpoint);
  }

  /** @internal for tests — pure function re-exported for convenience */
  private processSSELine(
    trimmed: string,
    endpoint: string,
    state: { fullContent: string; toolCalls: any[]; finishReason: string },
    setFullContent: (val: string) => void,
    setFinishReason: (val: string) => void,
  ): void {
    processSSELine(trimmed, endpoint, state, setFullContent, setFinishReason);
  }

  /** @internal for tests — pure function */
  private repairToolCallArguments(tc: any): any {
    return repairToolCallArguments(tc);
  }

  /** @internal for tests — pure function */
  private tryRepairTruncatedJson(text: string): string | null {
    return tryRepairTruncatedJson(text);
  }

  /** @internal for tests — pure function */
  private extractFirstJson(text: string): string | null {
    return extractFirstJson(text);
  }

  /** @internal for tests — pure function */
  private detectTruncatedToolCalls(toolCalls: any[]): any[] {
    return detectTruncatedToolCalls(toolCalls);
  }

  /** @internal for tests — pure function */
  private isMissingCriticalFields(toolName: string, parsed: any): boolean {
    return isMissingCriticalFields(toolName, parsed);
  }

  /** @internal for tests — pure function */
  private summarizeToolArgs(toolName: string, toolArgs: Record<string, unknown>): string {
    return summarizeToolArgs(toolName, toolArgs);
  }

  /**
   * Release resources
   */
  public dispose(): void {
    this.disposed = true;
    this.contextHistory = [];
    this.chatHistory = [];
  }
}
