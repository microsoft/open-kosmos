/**
 * SubAgentContextCompactor — Context compaction logic for SubAgentChat
 *
 * Extracted from subAgentChat.ts to keep that file within the 500-line renderer limit
 * and to isolate the compression concern.
 *
 * Design notes:
 * - Holds a reference to the caller's contextHistory array.
 * - In-place mutations (push, splice) are visible to the caller.
 * - compressEarlyMessages replaces array contents via splice (not reassignment)
 *   so the original reference stays valid.
 *
 * File location: src/main/lib/subAgent/subAgentContextCompactor.ts
 */

import type { Message } from '@shared/types/chatTypes';
import { MessageHelper } from '@shared/types/chatTypes';
import { ghcModelApi } from '../llm/ghcModelApi';
import { createConsoleLogger } from '../unifiedLogger';
import { TokenCounter } from '../token/TokenCounter';
import { SubAgentTaskStore } from './subAgentTaskStore';
import type { SubAgentChatOptions } from './types';

// Lazy-init logger (mirrors the pattern in subAgentChat.ts)
let logger: any;
(async () => {
  logger = await createConsoleLogger();
})();

function getLogger() {
  return logger || console;
}

/** Compact context configuration constants */
const COMPACT_CONTEXT_CONFIG = {
  COMPRESSION_THRESHOLD: 0.60,
  FALLBACK_CONTEXT_WINDOW: 128000,
  MSG_COUNT_COMPRESS_THRESHOLD: 20,
  MSG_COUNT_COMPRESS_BATCH: 15,
  MSG_COUNT_COMPRESS_MAX_TOKENS: 3000,
  MSG_COUNT_COMPRESS_TIMEOUT_MS: 20000,
} as const;

/**
 * Tool result LLM smart compression configuration
 */
const TOOL_RESULT_SUMMARIZE_CONFIG = {
  SUMMARIZE_THRESHOLD: 15000,
  SUMMARIZE_MODEL: 'claude-haiku-4.5' as const,
  SUMMARIZE_MAX_TOKENS: 2000,
  SUMMARIZE_TIMEOUT_MS: 15000,
  MAX_TOOL_RESULT_CHARS: 50000,
} as const;

/** Lazy-loaded TokenCounter singleton */
let _tokenCounter: any = null;
async function getTokenCounter(): Promise<any> {
  if (!_tokenCounter) {
    _tokenCounter = new TokenCounter({ enableCache: true });
  }
  return _tokenCounter;
}

export class SubAgentContextCompactor {
  constructor(
    /** Reference to the caller's context history array — in-place mutations are reflected in SubAgentChat */
    private readonly contextHistory: Message[],
    private readonly options: SubAgentChatOptions,
    private readonly contextWindowSize: number,
    // tokenCounter param reserved for future injection; currently uses the module-level singleton
    private readonly _tokenCounter: TokenCounter
  ) {}

  // ====== Public API ======

  /**
   * Check and compress context before each LLM call.
   *
   * Phase 0: When message count exceeds threshold, distill early messages via LLM.
   * Phase 1: When token usage exceeds 60% threshold, compress all but the last 3 messages.
   */
  public async compactContextIfNeeded(
    systemMessages: Message[],
    availableTools: any[]
  ): Promise<void> {
    if (this.contextHistory.length === 0) return;

    try {
      const { MSG_COUNT_COMPRESS_THRESHOLD, MSG_COUNT_COMPRESS_BATCH } = COMPACT_CONTEXT_CONFIG;
      if (this.contextHistory.length > MSG_COUNT_COMPRESS_THRESHOLD) {
        getLogger().info?.(
          `[SubAgentContextCompactor] Phase 0 triggered: ${this.contextHistory.length} messages > ` +
          `${MSG_COUNT_COMPRESS_THRESHOLD} threshold. Compressing first ${MSG_COUNT_COMPRESS_BATCH} messages via LLM.`,
          'compactContextIfNeeded'
        );
        await this.compressEarlyMessages(MSG_COUNT_COMPRESS_BATCH);
      }

      const tokenCounter = await getTokenCounter();
      const contextWindowSize = this.contextWindowSize;
      if (contextWindowSize <= 0) return;

      const systemTokens = this.estimateMessagesTokens(tokenCounter, systemMessages);
      const contextTokens = this.estimateMessagesTokens(tokenCounter, this.contextHistory);
      const toolsTokens = this.estimateToolsTokens(tokenCounter, availableTools);
      const totalTokens = systemTokens + contextTokens + toolsTokens;

      const usageRatio = totalTokens / contextWindowSize;

      if (usageRatio < COMPACT_CONTEXT_CONFIG.COMPRESSION_THRESHOLD) {
        return;
      }

      getLogger().info?.(
        `[SubAgentContextCompactor] Context compaction triggered: ${totalTokens} tokens ` +
        `(${(usageRatio * 100).toFixed(1)}% of ${contextWindowSize} window). ` +
        `Messages: ${this.contextHistory.length}`,
        'compactContextIfNeeded'
      );

      const compressBatch = this.contextHistory.length - 3;
      if (compressBatch > 0) {
        getLogger().info?.(
          `[SubAgentContextCompactor] Phase 1 (LLM compress): compressing first ${compressBatch} of ` +
          `${this.contextHistory.length} messages`,
          'compactContextIfNeeded'
        );
        await this.compressEarlyMessages(compressBatch);
      }
    } catch (error) {
      getLogger().warn?.(
        `[SubAgentContextCompactor] Context compaction failed (non-fatal): ` +
        `${error instanceof Error ? error.message : String(error)}`,
        'compactContextIfNeeded'
      );
    }
  }

  /**
   * Safety net: remove orphaned role=tool messages that have no matching tool_call in any
   * preceding assistant message. Called before sending messages to the LLM.
   */
  public sanitizeOrphanedToolResults(messages: Message[]): Message[] {
    const toolCallIds = new Set<string>();
    const result: Message[] = [];
    let orphanCount = 0;

    for (const msg of messages) {
      if (msg.role === 'assistant' && msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          if (tc.id) {
            toolCallIds.add(tc.id);
          }
        }
      }
    }

    for (const msg of messages) {
      if (msg.role === 'tool' && msg.tool_call_id) {
        if (!toolCallIds.has(msg.tool_call_id)) {
          orphanCount++;
          continue;
        }
      }
      result.push(msg);
    }

    if (orphanCount > 0) {
      getLogger().warn?.(
        `[SubAgentContextCompactor] Removed ${orphanCount} orphaned tool_result message(s) ` +
        `(no matching tool_call in any assistant message). Likely caused by context compression.`,
        'sanitizeOrphanedToolResults'
      );
    }

    return result;
  }

  /**
   * Smart compression of large tool results.
   *
   * 1. Try distilling via claude-haiku-4.5.
   * 2. On failure or timeout, fall back to hard truncation.
   */
  public async compressToolResult(
    content: string,
    toolName: string,
    originalLength: number
  ): Promise<string> {
    const { SUMMARIZE_MODEL, SUMMARIZE_MAX_TOKENS, SUMMARIZE_TIMEOUT_MS, MAX_TOOL_RESULT_CHARS } =
      TOOL_RESULT_SUMMARIZE_CONFIG;

    try {
      getLogger().info?.(
        `[SubAgentContextCompactor] Compressing tool '${toolName}' result via ${SUMMARIZE_MODEL} ` +
        `(${originalLength} chars)`,
        'compressToolResult'
      );

      const inputForLlm = content.length > MAX_TOOL_RESULT_CHARS
        ? content.substring(0, MAX_TOOL_RESULT_CHARS)
        : content;

      const summaryPromise = ghcModelApi.callModel(
        SUMMARIZE_MODEL,
        `Below is the output from a tool called "${toolName}". ` +
        `Extract and summarize the KEY INFORMATION that would be useful for completing the user's task. ` +
        `Preserve:\n` +
        `- Important facts, data points, and findings\n` +
        `- URLs, file paths, code snippets, and structured data\n` +
        `- Error messages or warnings\n` +
        `Discard:\n` +
        `- HTML/CSS/JS boilerplate, navigation menus, ads, footers\n` +
        `- Redundant or repetitive content\n` +
        `- Raw markup/styling\n\n` +
        `TOOL OUTPUT:\n${inputForLlm}`,
        'You are a precise information extractor. Summarize tool output concisely while preserving all actionable information. Output only the summary, no explanations.',
        SUMMARIZE_MAX_TOKENS,
        0.2
      );

      const timeoutPromise = new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), SUMMARIZE_TIMEOUT_MS)
      );

      const summary = await Promise.race([summaryPromise, timeoutPromise]);

      if (summary && summary.length > 0) {
        const compressedResult = `[Summarized from ${originalLength} chars by ${SUMMARIZE_MODEL}]\n\n${summary}`;
        getLogger().info?.(
          `[SubAgentContextCompactor] Tool '${toolName}' result compressed: ` +
          `${originalLength} → ${compressedResult.length} chars ` +
          `(${((1 - compressedResult.length / originalLength) * 100).toFixed(0)}% reduction)`,
          'compressToolResult'
        );
        return compressedResult;
      }

      getLogger().warn?.(
        `[SubAgentContextCompactor] LLM compression returned empty for '${toolName}', falling back to truncation`,
        'compressToolResult'
      );
    } catch (error) {
      getLogger().warn?.(
        `[SubAgentContextCompactor] LLM compression failed for '${toolName}': ` +
        `${error instanceof Error ? error.message : String(error)}. Falling back to truncation.`,
        'compressToolResult'
      );
    }

    if (content.length > MAX_TOOL_RESULT_CHARS) {
      const truncated =
        content.substring(0, MAX_TOOL_RESULT_CHARS) +
        `\n\n[... content truncated from ${originalLength} chars to ${MAX_TOOL_RESULT_CHARS} chars. ` +
        `The full result was too large for sub-agent context. Tool: ${toolName} ...]`;
      getLogger().warn?.(
        `[SubAgentContextCompactor] Tool '${toolName}' result hard-truncated: ` +
        `${originalLength} → ${MAX_TOOL_RESULT_CHARS} chars`,
        'compressToolResult'
      );
      return truncated;
    }

    return content;
  }

  // ====== Private helpers ======

  /**
   * Adjust batch boundary so that tool_call ↔ tool_result pairs are never split.
   */
  private adjustBatchBoundaryForToolPairs(batchSize: number): number {
    let adjusted = batchSize;

    while (adjusted < this.contextHistory.length - 1) {
      const lastBatchMsg = this.contextHistory[adjusted - 1];
      const nextMsg = this.contextHistory[adjusted];

      if (
        lastBatchMsg?.role === 'assistant' &&
        Array.isArray(lastBatchMsg.tool_calls) &&
        lastBatchMsg.tool_calls.length > 0
      ) {
        if (nextMsg?.role === 'tool') {
          adjusted++;
          continue;
        }
      }

      if (nextMsg?.role === 'tool') {
        adjusted++;
        continue;
      }

      break;
    }

    adjusted = Math.min(adjusted, this.contextHistory.length - 1);

    if (adjusted !== batchSize) {
      getLogger().info?.(
        `[SubAgentContextCompactor] Adjusted batch boundary: ${batchSize} → ${adjusted} ` +
        `(to preserve tool_call ↔ tool_result pairing)`,
        'adjustBatchBoundaryForToolPairs'
      );
    }

    return adjusted;
  }

  /**
   * Estimate token count for a message list.
   */
  private estimateMessagesTokens(tokenCounter: any, messages: Message[]): number {
    let total = 0;
    for (const msg of messages) {
      total += 3; // per-message overhead
      const text = this.getMessageText(msg);
      if (text) {
        total += tokenCounter.countTextTokens(text);
      }
      if (msg.role === 'assistant' && msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          total += tokenCounter.countTextTokens(JSON.stringify(tc));
        }
      }
      if (msg.role === 'tool') {
        total += tokenCounter.countTextTokens(msg.name) + 1;
      }
    }
    return total;
  }

  /**
   * Estimate token count for tool definitions.
   */
  private estimateToolsTokens(tokenCounter: any, tools: any[]): number {
    if (!tools || tools.length === 0) return 0;
    return tokenCounter.countTextTokens(JSON.stringify(tools));
  }

  /**
   * Extract plain text content from a message.
   */
  private getMessageText(msg: Message): string {
    if (Array.isArray(msg.content)) {
      return msg.content
        .filter((p: any) => p.type === 'text')
        .map((p: any) => p.text)
        .join('');
    }
    return String(msg.content || '');
  }

  /**
   * Phase 0: Distill the first batchSize messages into a single LLM summary.
   *
   * Uses splice to mutate the original contextHistory array in-place so that the
   * reference held by SubAgentChat remains valid after the replacement.
   */
  private async compressEarlyMessages(batchSize: number): Promise<void> {
    const { MSG_COUNT_COMPRESS_MAX_TOKENS, MSG_COUNT_COMPRESS_TIMEOUT_MS } = COMPACT_CONTEXT_CONFIG;

    let actualBatch = Math.min(batchSize, this.contextHistory.length - 1);
    if (actualBatch <= 0) return;

    actualBatch = this.adjustBatchBoundaryForToolPairs(actualBatch);
    if (actualBatch <= 0 || actualBatch >= this.contextHistory.length) return;

    const earlyMessages = this.contextHistory.slice(0, actualBatch);
    const remainingMessages = this.contextHistory.slice(actualBatch);

    const conversationText = earlyMessages
      .map((msg, idx) => {
        const role = msg.role.toUpperCase();
        const text = this.getMessageText(msg);
        const toolInfo = msg.role === 'tool' ? ` (tool: ${msg.name})` : '';
        const toolCalls =
          msg.role === 'assistant' && msg.tool_calls
            ? `\n  [Called tools: ${msg.tool_calls.map((tc: any) => tc.function?.name).join(', ')}]`
            : '';
        const truncatedText =
          text.length > 2000 ? text.substring(0, 2000) + '...[truncated]' : text;
        return `[${idx + 1}] ${role}${toolInfo}: ${truncatedText}${toolCalls}`;
      })
      .join('\n\n');

    try {
      getLogger().info?.(
        `[SubAgentContextCompactor] Compressing ${actualBatch} early messages via LLM ` +
        `(total text: ${conversationText.length} chars)`,
        'compressEarlyMessages'
      );

      const summaryPromise = ghcModelApi.callModel(
        TOOL_RESULT_SUMMARIZE_CONFIG.SUMMARIZE_MODEL,
        `Below is the early conversation history of a sub-agent working on a task. ` +
        `Summarize the KEY PROGRESS and FINDINGS so far into a concise structured summary.\n\n` +
        `Preserve:\n` +
        `- What tools were called and their key results\n` +
        `- Important data, URLs, file paths, code discovered\n` +
        `- Decisions made and current progress status\n` +
        `- Any errors encountered and how they were handled\n\n` +
        `Discard:\n` +
        `- Verbatim tool output details (keep only key findings)\n` +
        `- Repetitive or redundant information\n` +
        `- Raw HTML/CSS/JS content\n\n` +
        `CONVERSATION HISTORY:\n${conversationText}`,
        'You are a precise conversation summarizer. Create a structured summary of the sub-agent conversation progress. Output only the summary in a clear, organized format. Use sections with headers.',
        MSG_COUNT_COMPRESS_MAX_TOKENS,
        0.2
      );

      const timeoutPromise = new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), MSG_COUNT_COMPRESS_TIMEOUT_MS)
      );

      const summary = await Promise.race([summaryPromise, timeoutPromise]);

      if (summary && summary.length > 0) {
        const summaryMessage = MessageHelper.createTextMessage(
          `[Context Summary — compressed from ${actualBatch} earlier messages]\n\n${summary}`,
          'user'
        );

        // Mutate in-place so SubAgentChat's reference stays valid
        this.contextHistory.splice(0, this.contextHistory.length, summaryMessage, ...remainingMessages);

        if (this.options.taskId) {
          SubAgentTaskStore.getInstance().replaceContextHistory(
            this.options.taskId,
            this.contextHistory
          );
        }

        getLogger().info?.(
          `[SubAgentContextCompactor] Phase 0 complete: ${actualBatch} messages → 1 summary ` +
          `(${summary.length} chars). New total: ${this.contextHistory.length} messages.`,
          'compressEarlyMessages'
        );
        return;
      }

      getLogger().warn?.(
        `[SubAgentContextCompactor] LLM summary returned empty, falling back to simple truncation`,
        'compressEarlyMessages'
      );
    } catch (error) {
      getLogger().warn?.(
        `[SubAgentContextCompactor] LLM compression of early messages failed: ` +
        `${error instanceof Error ? error.message : String(error)}. Falling back to simple truncation.`,
        'compressEarlyMessages'
      );
    }

    // Fallback: simple concatenation + truncation (no LLM dependency)
    const fallbackText = earlyMessages
      .map((msg) => {
        const role = msg.role;
        const text = this.getMessageText(msg);
        return `[${role}]: ${text.substring(0, 500)}`;
      })
      .join('\n');
    const maxFallbackChars = 5000;
    const truncatedFallback =
      fallbackText.length > maxFallbackChars
        ? fallbackText.substring(0, maxFallbackChars) + '\n...[truncated]'
        : fallbackText;

    const fallbackMessage = MessageHelper.createTextMessage(
      `[Context Summary — truncated from ${actualBatch} earlier messages]\n\n${truncatedFallback}`,
      'user'
    );

    // Mutate in-place so SubAgentChat's reference stays valid
    this.contextHistory.splice(0, this.contextHistory.length, fallbackMessage, ...remainingMessages);

    if (this.options.taskId) {
      SubAgentTaskStore.getInstance().replaceContextHistory(
        this.options.taskId,
        this.contextHistory
      );
    }

    getLogger().info?.(
      `[SubAgentContextCompactor] Phase 0 fallback: ${actualBatch} messages → 1 truncated summary. ` +
      `New total: ${this.contextHistory.length} messages.`,
      'compressEarlyMessages'
    );
  }
}
