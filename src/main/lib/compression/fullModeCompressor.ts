// src/main/lib/compression/fullModeCompressor.ts
// Ported from VSCode Copilot Chat Full Mode compression algorithm.
// Handles intelligent compression of OpenKosmos Messages.

import { Message, ToolMessage, ToolCall, MessageHelper } from '@shared/types/chatTypes';
import { contextCompressionLlmSummarizer } from '../llm/contextCompressionLlmSummarizer';
import { TokenCounter } from '../token';
import { createLogger } from '../unifiedLogger';

const logger = createLogger();

/**
 * Full Mode compression configuration.
 */
export interface FullModeCompressionConfig {
  /** Number of recent messages to preserve. */
  preserveRecentMessages: number;
  /** Whether to additionally pin the first user message (disabled by default to avoid positional hard-pinning). */
  preserveFirstUserMessage: boolean;
  /** Whether to additionally pin the first SKILL.md tool-call block (disabled by default to avoid positional hard-pinning). */
  preserveFirstSkillToolCall: boolean;
  /** Conservative prompt-token budget used to bound each summarization pass */
  summaryPromptTokenBudget: number;
  /** Maximum number of retries. */
  maxRetries: number;
  /** Maximum recursive summary passes before failing back to non-LLM fallback */
  maxSummaryRecursionDepth: number;
  /** Maximum number of first-layer conversation chunk summaries allowed in flight at once */
  maxConcurrentChunkSummaries: number;
  /** Whether to enable debug logging. */
  enableDebugLog: boolean;
}

/**
 * Compression result.
 */
export interface FullModeCompressionResult {
  /** Whether compression succeeded. */
  success: boolean;
  /** Original message list. */
  originalMessages: Message[];
  /** Compressed message list. */
  compressedMessages: Message[];
  /** Description of the compression strategy used. */
  strategy: string;
  /** Range of messages that were compressed. */
  compressedRange?: {
    startIndex: number;
    endIndex: number;
    messageCount: number;
  };
  /** Summary content, if applicable. */
  summary?: string;
  /** Processing time in ms. */
  processingTime: number;
  /** Error message, if any. */
  error?: string;
  /** Metadata. */
  metadata: {
    preservedFirst: boolean;
    preservedRecent: number;
    compressionMethod: 'summary' | 'none' | 'fallback';
    timestamp: number;
    /** Number of chunk-level summarize() invocations (one per chunk) */
    chunkSummaryCallCount: number;
    /** Total LLM API calls including retries across all chunks */
    totalLlmCallCount: number;
  };
}
/**
 * General-purpose OpenKosmos task compressor.
 * Intelligent compression using a helper-owned structured-summary strategy, adapted for general task scenarios.
 */
export class FullModeCompressor {
  private config: FullModeCompressionConfig;
  private readonly tokenCounter: TokenCounter;
  private chunkSummaryCallCount = 0;
  private totalLlmCallCount = 0;
  private static readonly MAX_TOOL_TEXT_CHARS = 1200;
  private static readonly MAX_TEXT_MESSAGE_CHARS = 2400;
  private static readonly MIN_EFFECTIVE_SUMMARY_CONTENT_TOKENS = 64;
  private static readonly MIN_MERGE_MESSAGE_TOKENS = 128;
  private static readonly MERGE_SUMMARY_HEADER = 'Chunk summary to merge:\n';
  private static readonly SINGLE_MESSAGE_TRUNCATION_SUFFIX = '\n[Truncated to fit summary prompt budget]';

  // Default configuration
  private static readonly DEFAULT_CONFIG: FullModeCompressionConfig = {
    preserveRecentMessages: 5,
    preserveFirstUserMessage: false,
    preserveFirstSkillToolCall: false,
    summaryPromptTokenBudget: 100000,
    maxRetries: 3,
    maxSummaryRecursionDepth: 4,
    maxConcurrentChunkSummaries: 2,
    enableDebugLog: false
  };

  constructor(config: Partial<FullModeCompressionConfig> = {}) {
    this.config = { ...FullModeCompressor.DEFAULT_CONFIG, ...config };
    this.tokenCounter = new TokenCounter({ enableCache: true, encoding: 'o200k_base' });
  }

  /**
   * Compress a message list.
   * Strategy: prioritize recent message continuity and tool-pairing integrity,
   * with optional extra anchors, then compress the middle portion.
   */
  async compressMessages(messages: Message[]): Promise<FullModeCompressionResult> {
    const startTime = Date.now();
    this.chunkSummaryCallCount = 0;
    this.totalLlmCallCount = 0;

    try {
      // 1. Analyze message structure
      const analysis = this.analyzeMessageStructure(messages);

      // 2. Return early if compression is not needed
      if (!analysis.needsCompression) {
        return this.createResult(
          true,
          messages,
          messages,
          'no_compression_needed',
          startTime,
          analysis
        );
      }

      // 3. Perform compression
      const compressionResult = await this.performCompression(messages, analysis);

      // 4. Return result
      return this.createResult(
        true,
        messages,
        compressionResult.compressedMessages,
        'intelligent_summary',
        startTime,
        analysis,
        compressionResult.summary
      );

    } catch (error) {
      // Fall back to simple preservation strategy
      const fallbackResult = this.performFallbackCompression(messages);

      return this.createResult(
        false,
        messages,
        fallbackResult,
        'fallback_preservation',
        startTime,
        this.analyzeMessageStructure(messages),
        undefined,
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  /**
   * Find the first successful SKILL.md read_file tool call and its corresponding tool result.
   * Returns an array of message indices to protect.
   *
   * IMPORTANT: When an assistant message has multiple tool_calls (e.g. read_file + get_current_datetime),
   * we must protect ALL sibling tool results — not just the skill.md one — to maintain tool_use/tool_result
   * pairing integrity required by LLM APIs (especially Claude).
   */
  private findFirstSkillToolCallIndices(messages: Message[]): number[] {
    const protectedIndices: number[] = [];

    // 1. Find the first assistant message that contains a read_file call targeting skill.md
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];

      // Check for an assistant message with tool_calls
      if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
        // Find a read_file call whose target file name includes skill.md (case-insensitive)
        const skillToolCall = msg.tool_calls.find(tc => {
          if (tc.function?.name === 'read_file') {
            try {
              const args = typeof tc.function.arguments === 'string'
                ? JSON.parse(tc.function.arguments)
                : tc.function.arguments;
              const filePath = args?.filePath || args?.path || '';
              return filePath.toLowerCase().includes('skill.md');
            } catch {
              return false;
            }
          }
          return false;
        });

        if (skillToolCall) {
          // Found an assistant message with a skill.md read_file call
          protectedIndices.push(i);

          // 2. Protect ALL tool_results for every tool_call in this assistant message.
          // When an assistant message has multiple tool_calls, ALL sibling tool_results must be
          // preserved — otherwise the LLM API (e.g. Claude) returns 400 due to missing tool_result.
          const allToolCallIds = msg.tool_calls.map(tc => tc.id);
          for (let j = i + 1; j < messages.length; j++) {
            const resultMsg = messages[j];
            if (resultMsg.role === 'tool' && resultMsg.tool_call_id && allToolCallIds.includes(resultMsg.tool_call_id)) {
              protectedIndices.push(j);
            }
            // Stop scanning once we hit the next assistant or user message
            // (tool results are always immediately after the assistant message)
            if (resultMsg.role === 'assistant' || resultMsg.role === 'user') {
              break;
            }
          }

          // Protect only the first skill block, then stop
          break;
        }
      }
    }

    return protectedIndices;
  }

  /**
   * Analyze the message structure.
   */
  private analyzeMessageStructure(messages: Message[]): {
    totalMessages: number;
    firstUserMessageIndex: number;
    firstSkillToolCallIndices: number[];
    recentMessagesStartIndex: number;
    middleMessagesRange: { start: number; end: number; count: number } | null;
    needsCompression: boolean;
  } {
    const totalMessages = messages.length;

    // Find the first user message
    const firstUserMessageIndex = this.config.preserveFirstUserMessage
      ? messages.findIndex(msg => msg.role === 'user')
      : -1;

    // Find the first successful SKILL.md read_file tool call and its tool result
    const firstSkillToolCallIndices = this.config.preserveFirstSkillToolCall
      ? this.findFirstSkillToolCallIndices(messages)
      : [];

    // Calculate the starting index of the recent messages window
    const recentMessagesStartIndex = Math.max(
      0,
      totalMessages - this.config.preserveRecentMessages
    );

    // Calculate the range of middle messages that need compression
    let middleMessagesRange: { start: number; end: number; count: number } | null = null;
    let needsCompression = false;

    if (firstUserMessageIndex !== -1 && firstUserMessageIndex < recentMessagesStartIndex - 1) {
      // There are middle messages to compress
      middleMessagesRange = {
        start: firstUserMessageIndex + 1,
        end: recentMessagesStartIndex - 1,
        count: recentMessagesStartIndex - firstUserMessageIndex - 1
      };
      needsCompression = middleMessagesRange.count > 0;
    } else if (firstUserMessageIndex === -1 && totalMessages > this.config.preserveRecentMessages) {
      // No first user message pinned, but total count exceeds the retention window
      middleMessagesRange = {
        start: 0,
        end: recentMessagesStartIndex - 1,
        count: recentMessagesStartIndex
      };
      needsCompression = middleMessagesRange.count > 0;
    }

    return {
      totalMessages,
      firstUserMessageIndex,
      firstSkillToolCallIndices,
      recentMessagesStartIndex,
      middleMessagesRange,
      needsCompression
    };
  }

  /**
   * Perform intelligent compression.
   */
  private async performCompression(
    messages: Message[],
    analysis: ReturnType<typeof this.analyzeMessageStructure>
  ): Promise<{ compressedMessages: Message[]; summary?: string }> {
    const { firstUserMessageIndex, firstSkillToolCallIndices, middleMessagesRange, recentMessagesStartIndex } = analysis;

    if (!middleMessagesRange) {
      return { compressedMessages: messages };
    }

    // Build the set of protected indices (those within the middle range that are pinned)
    const protectedMiddleIndices = new Set(
      firstSkillToolCallIndices.filter(
        idx => idx >= middleMessagesRange.start && idx <= middleMessagesRange.end
      )
    );

    // Extract the middle messages to compress (excluding protected messages)
    const middleMessages = messages.slice(
      middleMessagesRange.start,
      middleMessagesRange.end + 1
    ).filter((_, idx) => !protectedMiddleIndices.has(middleMessagesRange.start + idx));

    // Generate summary
    const summary = await this.generateSummary(this.prepareMessagesForCompression(middleMessages));

    // Build the compressed message list
    const compressedMessages: Message[] = [];

    // 1. Add the first user message (if pinned)
    if (firstUserMessageIndex !== -1 && firstUserMessageIndex < middleMessagesRange.start) {
      compressedMessages.push(messages[firstUserMessageIndex]);
    }

    // 2. Add messages between the first user message and the start of the middle range
    if (firstUserMessageIndex !== -1 && firstUserMessageIndex + 1 < middleMessagesRange.start) {
      compressedMessages.push(...messages.slice(firstUserMessageIndex + 1, middleMessagesRange.start));
    } else if (firstUserMessageIndex === -1 && middleMessagesRange.start > 0) {
      compressedMessages.push(...messages.slice(0, middleMessagesRange.start));
    }

    // 3. Add the summary message
    if (summary) {
      const summaryMessage = MessageHelper.createTextMessage(
        summary,
        'user',
        `summary_${Date.now()}`
      );
      compressedMessages.push(summaryMessage);
    }

    // 4. Add protected SKILL.md tool call + tool result (if they fall in the middle range), in original order
    const sortedProtectedIndices = Array.from(protectedMiddleIndices).sort((a, b) => a - b);
    for (const idx of sortedProtectedIndices) {
      compressedMessages.push(messages[idx]);
    }

    // 5. Add recent messages
    compressedMessages.push(...messages.slice(recentMessagesStartIndex));

    // 6. Ensure tool_use / tool_result integrity in the final compressed messages
    const validatedMessages = this.ensureToolResultIntegrity(compressedMessages, messages);

    // 7. Ensure the last message is user-role to prevent prefill 400 errors
    const finalMessages = this.ensureLastMessageIsUser(validatedMessages);

    return { compressedMessages: finalMessages, summary };
  }

  /**
   * Ensure every assistant tool_call has a matching tool_result. Missing results
   * are injected from originals or replaced with synthetic placeholders.
   */
  private ensureToolResultIntegrity(compressedMessages: Message[], originalMessages: Message[]): Message[] {
    const originalToolResultMap = new Map<string, Message>();
    for (const msg of originalMessages) {
      if (msg.role === 'tool' && msg.tool_call_id) originalToolResultMap.set(msg.tool_call_id, msg);
    }

    const existingToolResultIds = new Set<string>();
    for (const msg of compressedMessages) {
      if (msg.role === 'tool' && msg.tool_call_id) {
        existingToolResultIds.add(msg.tool_call_id);
      }
    }

    const result: Message[] = [];
    for (let i = 0; i < compressedMessages.length; i++) {
      const msg = compressedMessages[i];
      result.push(msg);

      if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
        const missingToolCallIds: string[] = [];
        for (const tc of msg.tool_calls) {
          if (tc.id && !existingToolResultIds.has(tc.id)) missingToolCallIds.push(tc.id);
        }

        if (missingToolCallIds.length > 0) {
          for (let j = i + 1; j < compressedMessages.length; j++) {
            const nextMsg = compressedMessages[j];
            if (nextMsg.role === 'tool' && nextMsg.tool_call_id &&
                msg.tool_calls.some(tc => tc.id === nextMsg.tool_call_id)) {
              continue;
            }
            break;
          }

          for (const missingId of missingToolCallIds) {
            const originalResult = originalToolResultMap.get(missingId);
            if (originalResult) {
              result.push(originalResult);
              existingToolResultIds.add(missingId);
            } else {
              const toolCall = msg.tool_calls.find(tc => tc.id === missingId);
              result.push(MessageHelper.createToolMessage(
                '[Result compressed]', missingId, toolCall?.function?.name || 'unknown', `synthetic_${missingId}`
              ));
              existingToolResultIds.add(missingId);
            }
          }
        }
      }
    }

    // Second pass: remove orphaned tool results whose tool_call was compressed away
    const allToolCallIds = new Set<string>();
    for (const msg of result) {
      if (msg.role === 'assistant' && msg.tool_calls) {
        for (const tc of msg.tool_calls) { if (tc.id) allToolCallIds.add(tc.id); }
      }
    }
    return result.filter(msg => {
      if (msg.role === 'tool' && msg.tool_call_id) return allToolCallIds.has(msg.tool_call_id);
      return true;
    });
  }

  /**
   * Ensure the last message is user-role to prevent assistant-prefill 400 errors.
   */
  private ensureLastMessageIsUser(messages: Message[]): Message[] {
    if (messages.length === 0 || messages[messages.length - 1].role === 'user') {
      return messages;
    }
    logger.warn('[FullModeCompressor] Compressed messages end with non-user role, appending bridge', 'ensureLastMessageIsUser', {
      lastRole: messages[messages.length - 1].role,
      totalMessages: messages.length,
    });
    return [...messages, MessageHelper.createTextMessage('Continue from the conversation above.', 'user', `bridge_user_${Date.now()}`)];
  }

  /**
   * Generate an intelligent summary.
   */
  private async generateSummary(messages: Message[]): Promise<string> {
    return await this.summarizeMessagesRecursively(messages, 'conversation');
  }

  private async summarizeMessagesRecursively(
    messages: Message[],
    stage: 'conversation' | 'merge',
    depth = 0,
  ): Promise<string> {
    if (depth >= this.config.maxSummaryRecursionDepth) {
      throw new Error(`Exceeded maxSummaryRecursionDepth=${this.config.maxSummaryRecursionDepth} during ${stage} summary recursion`);
    }

    const chunks = this.chunkMessagesForSummary(messages, stage);
    if (chunks.length === 0) {
      return '';
    }

    if (chunks.length === 1) {
      const conversationText = this.buildConversationText(chunks[0]);
      return await this.callSummaryAPI(conversationText);
    }

    const partialSummaries = stage === 'conversation'
      ? await this.summarizeConversationChunksConcurrently(chunks)
      : await this.summarizeChunksSequentially(chunks);

    const mergeMessages = this.prepareMergeSummaryMessages(partialSummaries).map((summary, index) =>
      MessageHelper.createTextMessage(
        `${FullModeCompressor.MERGE_SUMMARY_HEADER}${summary}`,
        'assistant',
        `summary_chunk_${stage}_${index}`
      )
    );

    return await this.summarizeMessagesRecursively(mergeMessages, 'merge', depth + 1);
  }

  private async summarizeConversationChunksConcurrently(chunks: Message[][]): Promise<string[]> {
    const maxConcurrency = Math.max(1, this.config.maxConcurrentChunkSummaries);
    const partialSummaries = new Array<string>(chunks.length);
    let nextChunkIndex = 0;

    const workers = Array.from({ length: Math.min(maxConcurrency, chunks.length) }, async () => {
      while (true) {
        // Safe in Node/Electron's single-threaded event loop because no await occurs
        // between reading and incrementing nextChunkIndex, so each worker claims a
        // unique chunk before yielding to async summary execution.
        const chunkIndex = nextChunkIndex;
        nextChunkIndex += 1;

        if (chunkIndex >= chunks.length) {
          return;
        }

        const conversationText = this.buildConversationText(chunks[chunkIndex]);
        partialSummaries[chunkIndex] = await this.callSummaryAPI(conversationText);
      }
    });

    await Promise.all(workers);
    return partialSummaries;
  }

  private async summarizeChunksSequentially(chunks: Message[][]): Promise<string[]> {
    const partialSummaries: string[] = [];
    for (const chunk of chunks) {
      const conversationText = this.buildConversationText(chunk);
      partialSummaries.push(await this.callSummaryAPI(conversationText));
    }

    return partialSummaries;
  }

  private prepareMessagesForCompression(messages: Message[]): Message[] {
    return messages.map((message) => this.prepareMessageForCompression(message));
  }

  private prepareMessageForCompression(message: Message): Message {
    let cloned = structuredClone(message);
    const text = MessageHelper.getText(cloned);

    let maxChars = FullModeCompressor.MAX_TEXT_MESSAGE_CHARS;
    if (cloned.role === 'tool') {
      maxChars = FullModeCompressor.MAX_TOOL_TEXT_CHARS;
    }

    if (text.length > maxChars) {
      const compactText = this.buildCompressedPreview(cloned, text, maxChars);
      cloned = MessageHelper.setTextContent(cloned, compactText);
    }

    return cloned;
  }

  private buildCompressedPreview(message: Message, text: string, maxChars: number): string {
    if (message.role !== 'tool') {
      const preview = text.slice(0, Math.max(0, maxChars - 200));
      return `${preview}\n\n[Compressed for summary generation; originalLength=${text.length}; role=${message.role}]`;
    }

    const toolName = message.name;
    const parsedJson = this.tryParseJson(text);

    if (toolName === 'fetch_web_content') {
      return this.buildFetchWebContentPreview(parsedJson, text, maxChars, message);
    }

    if (toolName === 'read_file') {
      return this.buildReadFilePreview(parsedJson, text, maxChars, message);
    }

    if (toolName === 'execute_command' || toolName === 'run_in_terminal') {
      return this.buildCommandPreview(parsedJson, text, maxChars, message);
    }

    if (/(search|grep|semantic|query)/i.test(toolName)) {
      return this.buildSearchPreview(toolName, parsedJson, text, maxChars, message);
    }

    if (parsedJson && typeof parsedJson === 'object') {
      return this.buildGenericJsonPreview(parsedJson, text, maxChars, message);
    }

    const preview = text.slice(0, Math.max(0, maxChars - 200));
    return `${preview}\n\n[Compressed for summary generation; originalLength=${text.length}; role=tool; name=${toolName}]`;
  }

  private buildFetchWebContentPreview(parsedJson: any, rawText: string, maxChars: number, message: ToolMessage): string {
    const payload = this.unwrapPrimaryPayload(parsedJson);
    const url = this.extractString(payload, ['url', 'sourceUrl', 'pageUrl']);
    const title = this.extractString(payload, ['title', 'pageTitle']);
    const content = this.extractString(payload, ['content', 'text', 'markdown', 'body']) || rawText;
    const preview = content.slice(0, Math.max(0, maxChars - 320));
    return [
      '[Structured compression: fetch_web_content]',
      title ? `title=${title}` : null,
      url ? `url=${url}` : null,
      `contentPreview=${preview}`,
      `[Compressed for summary generation; originalLength=${rawText.length}; role=${message.role}; name=${message.name || 'fetch_web_content'}]`
    ].filter(Boolean).join('\n');
  }

  private buildReadFilePreview(parsedJson: any, rawText: string, maxChars: number, message: ToolMessage): string {
    const payload = this.unwrapPrimaryPayload(parsedJson);
    const filePath = this.extractString(payload, ['filePath', 'path', 'fileName']);
    const content = this.extractString(payload, ['content', 'text']) || rawText;
    const startLine = payload?.startLine;
    const endLine = payload?.endLine;
    const totalLines = payload?.totalLines;
    const size = payload?.size;
    const preview = content.slice(0, Math.max(0, maxChars - 360));
    return [
      '[Structured compression: read_file]',
      filePath ? `file=${filePath}` : null,
      startLine !== undefined ? `range=${startLine}-${endLine ?? startLine}` : null,
      totalLines !== undefined ? `totalLines=${totalLines}` : null,
      size !== undefined ? `size=${size}` : null,
      `contentPreview=${preview}`,
      `[Compressed for summary generation; originalLength=${rawText.length}; role=${message.role}; name=${message.name || 'read_file'}]`
    ].filter(Boolean).join('\n');
  }

  private buildCommandPreview(parsedJson: any, rawText: string, maxChars: number, message: ToolMessage): string {
    const payload = this.unwrapPrimaryPayload(parsedJson);
    const command = this.extractString(payload, ['command', 'cmd', 'lastCommand']);
    const exitCode = payload?.exitCode;
    const stdout = this.extractString(payload, ['stdout', 'output', 'result']) || rawText;
    const preview = stdout.slice(0, Math.max(0, maxChars - 300));
    return [
      `[Structured compression: ${message.name || 'command_output'}]`,
      command ? `command=${command}` : null,
      exitCode !== undefined ? `exitCode=${exitCode}` : null,
      `outputPreview=${preview}`,
      `[Compressed for summary generation; originalLength=${rawText.length}; role=${message.role}; name=${message.name || 'unknown_tool'}]`
    ].filter(Boolean).join('\n');
  }

  private buildSearchPreview(toolName: string, parsedJson: any, rawText: string, maxChars: number, message: ToolMessage): string {
    const payload = this.unwrapPrimaryPayload(parsedJson);
    const results = this.extractArray(payload, ['results', 'items', 'matches', 'data']);
    const previewItems = results
      .slice(0, 3)
      .map((item: any, index: number) => {
        if (typeof item === 'string') {
          return `${index + 1}. ${item}`;
        }
        const title = this.extractString(item, ['title', 'name', 'path', 'url']) || `item_${index + 1}`;
        const snippet = this.extractString(item, ['snippet', 'text', 'description', 'lineContent']);
        return snippet ? `${index + 1}. ${title} :: ${snippet}` : `${index + 1}. ${title}`;
      });
    const fallbackPreview = rawText.slice(0, Math.max(0, maxChars - 260));
    return [
      `[Structured compression: ${toolName}]`,
      results.length > 0 ? `resultCount=${results.length}` : null,
      previewItems.length > 0 ? `topResults=${previewItems.join(' | ')}` : `preview=${fallbackPreview}`,
      `[Compressed for summary generation; originalLength=${rawText.length}; role=${message.role}; name=${message.name || toolName}]`
    ].filter(Boolean).join('\n');
  }

  private buildGenericJsonPreview(parsedJson: any, rawText: string, maxChars: number, message: ToolMessage): string {
    const payload = this.unwrapPrimaryPayload(parsedJson);
    const keys = Object.keys(payload || {}).slice(0, 12);
    const preview = JSON.stringify(payload).slice(0, Math.max(0, maxChars - 240));
    return [
      '[Structured compression: json_payload]',
      keys.length > 0 ? `keys=${keys.join(',')}` : null,
      `preview=${preview}`,
      `[Compressed for summary generation; originalLength=${rawText.length}; role=${message.role}${message.name ? `; name=${message.name}` : ''}]`
    ].filter(Boolean).join('\n');
  }

  private tryParseJson(text: string): any | null {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  private unwrapPrimaryPayload(value: any): any {
    if (Array.isArray(value)) {
      return value[0] ?? {};
    }
    return value ?? {};
  }

  private extractString(value: any, keys: string[]): string | undefined {
    if (!value || typeof value !== 'object') {
      return undefined;
    }

    for (const key of keys) {
      const candidate = value[key];
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate;
      }
    }

    return undefined;
  }

  private extractArray(value: any, keys: string[]): any[] {
    if (!value || typeof value !== 'object') {
      return [];
    }

    for (const key of keys) {
      const candidate = value[key];
      if (Array.isArray(candidate)) {
        return candidate;
      }
    }

    return [];
  }

  private chunkMessagesForSummary(messages: Message[], stage: 'conversation' | 'merge'): Message[][] {
    if (messages.length === 0) {
      return [];
    }

    const availablePromptTokens = this.getAvailablePromptTokens();
    const chunks: Message[][] = [];
    let currentChunk: Message[] = [];
    let currentPromptTokens = 0;

    for (const originalMessage of messages) {
      const message = this.fitMessageToPromptBudget(originalMessage, availablePromptTokens, stage);
      const messagePromptTokens = this.estimateMessageSummaryPromptTokens(message, stage);
      if (
        currentChunk.length > 0 &&
        currentPromptTokens + messagePromptTokens > availablePromptTokens
      ) {
        chunks.push(currentChunk);
        currentChunk = [];
        currentPromptTokens = 0;
      }

      currentChunk.push(message);
      currentPromptTokens += messagePromptTokens;
    }

    if (currentChunk.length > 0) {
      chunks.push(currentChunk);
    }

    return chunks;
  }

  private getAvailablePromptTokens(): number {
    const promptOverheadTokens = contextCompressionLlmSummarizer.getPromptOverheadTokens(this.tokenCounter);
    const availablePromptTokens = this.config.summaryPromptTokenBudget - promptOverheadTokens;
    if (availablePromptTokens < FullModeCompressor.MIN_EFFECTIVE_SUMMARY_CONTENT_TOKENS) {
      throw new Error(
        `summaryPromptTokenBudget=${this.config.summaryPromptTokenBudget} is too small for the summary template overhead (${promptOverheadTokens} prompt tokens)`
      );
    }

    return availablePromptTokens;
  }

  private prepareMergeSummaryMessages(partialSummaries: string[]): string[] {
    const availablePromptTokens = this.getAvailablePromptTokens();
    const perMessageBudget = Math.max(
      FullModeCompressor.MIN_MERGE_MESSAGE_TOKENS,
      Math.floor(availablePromptTokens / 2),
    );

    return partialSummaries.map((summary) =>
      this.truncateTextToTokenBudget(summary, perMessageBudget, FullModeCompressor.MERGE_SUMMARY_HEADER)
    );
  }

  private truncateTextToTokenBudget(text: string, tokenBudget: number, prefix = ''): string {
    const fullText = `${prefix}${text}`;
    if (this.tokenCounter.countTextTokens(fullText) <= tokenBudget) {
      return text;
    }

    const suffix = '\n[Truncated for recursive merge budget]';
    let low = 0;
    let high = text.length;
    let best = '';

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const candidate = `${text.slice(0, mid)}${suffix}`;
      const candidateTokens = this.tokenCounter.countTextTokens(`${prefix}${candidate}`);

      if (candidateTokens <= tokenBudget) {
        best = candidate;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    return best || suffix.trim();
  }

  private estimateMessageSummaryPromptTokens(
    message: Message,
    stage: 'conversation' | 'merge',
  ): number {
    const prefix = stage === 'merge' ? FullModeCompressor.MERGE_SUMMARY_HEADER : '';
    const messagePart = this.buildConversationMessagePart(message, prefix);
    return this.tokenCounter.countTextTokens(`${messagePart}\n\n`);
  }

  private fitMessageToPromptBudget(
    message: Message,
    tokenBudget: number,
    stage: 'conversation' | 'merge',
  ): Message {
    if (this.estimateMessageSummaryPromptTokens(message, stage) <= tokenBudget) {
      return message;
    }

    const prefix = stage === 'merge' ? FullModeCompressor.MERGE_SUMMARY_HEADER : '';
    let cloned = structuredClone(message);
    const truncatedText = this.truncateMessageTextToPromptBudget(cloned, tokenBudget, prefix);
    cloned = MessageHelper.setTextContent(cloned, truncatedText);

    if (this.estimateMessageSummaryPromptTokens(cloned, stage) > tokenBudget) {
      throw new Error(`Unable to fit single ${message.role} message within summary prompt budget ${tokenBudget}`);
    }

    return cloned;
  }

  private truncateMessageTextToPromptBudget(message: Message, tokenBudget: number, prefix = ''): string {
    const originalText = MessageHelper.getText(message);
    const suffix = FullModeCompressor.SINGLE_MESSAGE_TRUNCATION_SUFFIX;
    let candidateMessage = structuredClone(message);
    const withSuffixBudgetCheck = (candidateText: string) => {
      candidateMessage = MessageHelper.setTextContent(candidateMessage, candidateText);
      const candidatePart = this.buildConversationMessagePart(candidateMessage, prefix);
      return this.tokenCounter.countTextTokens(`${candidatePart}\n\n`);
    };

    if (withSuffixBudgetCheck(originalText) <= tokenBudget) {
      return originalText;
    }

    let low = 0;
    let high = originalText.length;
    let best = '';

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const candidate = `${originalText.slice(0, mid)}${suffix}`;
      if (withSuffixBudgetCheck(candidate) <= tokenBudget) {
        best = candidate;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    if (best) {
      return best;
    }

    if (withSuffixBudgetCheck(suffix.trim()) <= tokenBudget) {
      return suffix.trim();
    }

    throw new Error(`Summary prompt budget ${tokenBudget} is too small to represent a truncated ${message.role} message`);
  }

  /**
   * Build the conversation text from a list of messages.
   */
  private buildConversationText(messages: Message[]): string {
    return messages.map((message) => this.buildConversationMessagePart(message)).join('\n\n');
  }

  private buildConversationMessagePart(message: Message, textPrefix = ''): string {
    const text = MessageHelper.getText(message);
    let messagePart = `**${message.role}**: ${textPrefix}${text}`;

    if (message.role === 'assistant' && message.tool_calls && message.tool_calls.length > 0) {
      const toolNames = message.tool_calls.map(tc => tc.function.name).join(', ');
      messagePart += ` [Tool calls: ${toolNames}]`;
    }

    if (MessageHelper.hasAttachments(message)) {
      const attachmentCounts = MessageHelper.getAttachmentCounts(message);
      const attachmentInfo = [];

      if (attachmentCounts.files > 0) {
        const files = MessageHelper.getFiles(message);
        attachmentInfo.push(`${attachmentCounts.files} files: ${files.map(f => f.file.fileName).join(', ')}`);
      }

      if (attachmentCounts.images > 0) {
        const images = MessageHelper.getImages(message);
        attachmentInfo.push(`${attachmentCounts.images} images: ${images.map(img => img.metadata.fileName).join(', ')}`);
      }

      if (attachmentInfo.length > 0) {
        messagePart += ` [Attachments: ${attachmentInfo.join('; ')}]`;
      }
    }

    return messagePart;
  }

  /**
   * Call the summary API.
   */
  private async callSummaryAPI(conversationText: string): Promise<string> {
    this.chunkSummaryCallCount += 1;
    const result = await contextCompressionLlmSummarizer.summarize({
      conversationText,
      maxRetries: this.config.maxRetries,
    });
    this.totalLlmCallCount += result.attempts;

    if (!result.success || !result.summary) {
      throw new Error(result.error || 'Summary API call failed after all retries');
    }

    return result.summary;
  }

  /**
   * Perform fallback compression (simple preservation strategy).
   */
  private performFallbackCompression(messages: Message[]): Message[] {
    const result: Message[] = [];

    // Add first user message
    if (this.config.preserveFirstUserMessage) {
      const firstUserIndex = messages.findIndex(msg => msg.role === 'user');
      if (firstUserIndex !== -1) {
        result.push(messages[firstUserIndex]);
      }
    }

    // Add recent messages
    const recentStartIndex = Math.max(0, messages.length - this.config.preserveRecentMessages);
    result.push(...messages.slice(recentStartIndex));

    // Deduplicate (avoid duplicating first user message and recent messages)
    const seen = new Set();
    const deduped = result.filter(msg => {
      const key = msg.id || `${msg.role}_${Date.now()}_${Math.random()}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });

    // Ensure tool_use / tool_result integrity in fallback too
    const validated = this.ensureToolResultIntegrity(deduped, messages);
    return this.ensureLastMessageIsUser(validated);
  }

  /**
   * Build the compression result object.
   */
  private createResult(
    success: boolean,
    originalMessages: Message[],
    compressedMessages: Message[],
    strategy: string,
    startTime: number,
    analysis: ReturnType<typeof this.analyzeMessageStructure>,
    summary?: string,
    error?: string
  ): FullModeCompressionResult {
    return {
      success,
      originalMessages,
      compressedMessages,
      strategy,
      compressedRange: analysis.middleMessagesRange ? {
        startIndex: analysis.middleMessagesRange.start,
        endIndex: analysis.middleMessagesRange.end,
        messageCount: analysis.middleMessagesRange.count
      } : undefined,
      summary,
      processingTime: Date.now() - startTime,
      error,
      metadata: {
        preservedFirst: analysis.firstUserMessageIndex !== -1,
        preservedRecent: Math.min(this.config.preserveRecentMessages, originalMessages.length),
        compressionMethod: summary ? 'summary' : (success ? 'none' : 'fallback'),
        timestamp: Date.now(),
        chunkSummaryCallCount: this.chunkSummaryCallCount,
        totalLlmCallCount: this.totalLlmCallCount
      }
    };
  }

  /**
   * Update the configuration at runtime.
   */
  updateConfig(newConfig: Partial<FullModeCompressionConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * Return the current configuration.
   */
  getConfig(): FullModeCompressionConfig {
    return { ...this.config };
  }
}

/**
 * Factory function for creating a Full Mode compressor.
 */
export function createFullModeCompressor(config?: Partial<FullModeCompressionConfig>): FullModeCompressor {
  return new FullModeCompressor(config);
}