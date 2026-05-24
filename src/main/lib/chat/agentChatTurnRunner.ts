import { Message, AssistantMessage, UserMessage, ToolCall, MessageHelper, StartChatCallbacks } from '@shared/types/chatTypes';
import { StreamingChunk } from '@shared/types/streamingTypes';

import { CancellationError, CancellationToken } from '../cancellation';
import { GhcApiError } from '../utilities/errors';
import { createLogger } from '../unifiedLogger';
import {
  applyStorageCompressionToRecentMessages,
  detectTruncatedToolCalls,
  normalizeToolCalls,
  sanitizeToolCallsForApi,
} from './agentChatUtilities';
import { ChatStatus } from './agentChatTypes';
import type { StreamingApiResponse } from './agentChatStreamingService';
import { isNonInteractiveRuntimeInteractionError } from './agentChatInteractionPolicy';

const logger = createLogger();
const AUTO_INJECTED_TOOL_IMAGE_TEXT = '[Image from tool result - automatically injected for vision model]';

export interface AgentChatTurnRunnerDeps {
  getAgentName(): string;
  getChatId(): string;
  getChatSessionId(): string;
  getCurrentChatSession(): import('../userDataADO/chatSessionFileOps').ChatSessionFile | null;
  getChatHistory(): Message[];
  getDisplayMessages(): Message[];
  getSessionFromAuthManager(): Promise<any | null>;
  runConversationAttempt(token?: CancellationToken, callbacks?: StartChatCallbacks): Promise<void>;
  checkAndCompress(options?: { emitStatus?: boolean; force?: boolean }): Promise<{ applied: boolean }>;
  setChatStatus(status: ChatStatus): void;
  callWithToolsStreaming(token?: CancellationToken): Promise<StreamingApiResponse>;
  addMessageToSession(message: Message): Promise<void>;
  batchValidateAndRequestApproval(toolCalls: Array<{ id: string; function: { name: string; arguments: string } }>): Promise<Map<string, boolean>>;
  executeToolCall(toolCall: any, approved?: boolean): Promise<any>;
  postProcessToolResult(toolCall: any, toolResult: any): Promise<any>;
  assertExecutionActive(token: CancellationToken | undefined, executionNonce: number, stage: string): void;
  createMcpImageHash(data: string, mimeType: string): string;
  hasInjectedMcpImageHash(hash: string): boolean;
  emitStreamingChunk(chunk: StreamingChunk): void;
  saveChatSession(): Promise<{ success: boolean; error?: string }>;
  calculateAndNotifyContext(): Promise<void>;
  extractFactsFromConversation(): Promise<void>;
  cleanupIncompleteToolCalls(): Promise<void>;
  resetMessagesToSave(): void;
  clearOutput(): void;
  getCurrentModelId(): string;
  onUsageReceived?(usage: { promptTokens: number; completionTokens: number; totalTokens: number }): void;
  anchorTokenEstimate?(apiPromptTokens: number): void;
}

export class AgentChatTurnRunner {
  private static readonly OVERFLOW_ERROR_PATTERNS = [
    /prompt is too long/i,
    /prompt token count/i,
    /exceeds the limit/i,
    /maximum context/i,
    /context length/i,
    /too many tokens/i,
  ];

  constructor(private readonly deps: AgentChatTurnRunnerDeps) {}

  async runRetry(options: { token?: CancellationToken; callbacks?: StartChatCallbacks }): Promise<Message[]> {
    const { token, callbacks } = options;

    logger.info('[AgentChat] 🔄 Retrying chat with existing context', 'retryChat', {
      hasCancellationToken: !!token,
      agentName: this.deps.getAgentName(),
    });

    try {
      this.throwIfCancelled(token, 'before retry starts');
      await this.deps.runConversationAttempt(token, callbacks);
      return this.deps.getDisplayMessages();
    } catch (error) {
      if (error instanceof CancellationError) {
        logger.info('[AgentChat] ✅ Retry cancelled gracefully', 'retryChat', {
          agentName: this.deps.getAgentName(),
        });
        throw error;
      }

      logger.error(`[AgentChat] Retry failed: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  async runStreamMessage(options: {
    userMessage: UserMessage;
    token?: CancellationToken;
    callbacks?: StartChatCallbacks;
    emitUserMessage?: boolean;
  }): Promise<Message[]> {
    const { userMessage, token, callbacks, emitUserMessage } = options;

    logger.info('[AgentChat] 🚀 Starting streamMessage', 'streamMessage', {
      messageId: userMessage.id,
      hasCancellationToken: !!token,
      agentName: this.deps.getAgentName(),
    });

    try {
      this.throwIfCancelled(token, 'before stream message starts');
      await this.deps.addMessageToSession(userMessage);

      if (emitUserMessage) {
        const messageId = userMessage.id || `user_${this.deps.getChatSessionId()}_${Date.now()}`;
        this.deps.emitStreamingChunk({
          chunkId: `${messageId}_msg`,
          messageId,
          chatId: this.deps.getChatId(),
          chatSessionId: this.deps.getChatSessionId(),
          timestamp: Date.now(),
          type: 'user_message',
          userMessage: {
            id: userMessage.id,
            role: 'user',
            content: userMessage.content,
            timestamp: userMessage.timestamp,
          },
        });
      }

      await this.deps.runConversationAttempt(token, callbacks);
      return this.deps.getDisplayMessages();
    } catch (error) {
      if (error instanceof CancellationError) {
        logger.info('[AgentChat] ✅ Operation cancelled gracefully', 'streamMessage', {
          agentName: this.deps.getAgentName(),
        });
        throw error;
      }

      logger.error(`[AgentChat] Conversation processing failed: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  async run(options: { token?: CancellationToken; callbacks?: StartChatCallbacks; executionNonce: number }): Promise<void> {
    const { token, executionNonce } = options;

    logger.info('[AgentChat] Starting chat conversation loop', 'startChat', {
      agentName: this.deps.getAgentName(),
      hasCancellationToken: !!token,
    });

    let requiresFollowUp = true;

    const sessionData = await this.deps.getSessionFromAuthManager();
    if (!sessionData) {
      throw new GhcApiError('GitHub Copilot authentication required', 401);
    }

    while (requiresFollowUp) {
      this.throwIfCancelled(token, 'conversation loop');

      await this.deps.checkAndCompress();
      this.throwIfCancelled(token, 'after compression');

      let streamingResponse: StreamingApiResponse;
      try {
        streamingResponse = await this.callWithOverflowRecovery(token);
      } catch (error) {
        // On stream cancellation, persist whatever assistant text was streamed so the
        // user can return to the session and still see (and resume from) the partial reply.
        // Without this, the partial content lives only in the renderer cache and is lost
        // the moment the user switches sessions or closes the window.
        const partialResponse = this.extractPartialResponseFromCancellation(error);
        if (partialResponse) {
          await this.persistPartialResponseOnCancellation(partialResponse);
        }
        throw error;
      }
      const response = streamingResponse.message;

      // Persist usage + model on the message for downstream analytics (pew integration).
      // Use API-reported model (canonical name from server) with config fallback.
      if (streamingResponse.usage) {
        response.usage = {
          prompt_tokens: streamingResponse.usage.promptTokens,
          completion_tokens: streamingResponse.usage.completionTokens,
          total_tokens: streamingResponse.usage.totalTokens,
        };
      }
      response.model = streamingResponse.model || this.deps.getCurrentModelId();

      // Accumulate token usage as buddy XP
      if (streamingResponse.usage && this.deps.onUsageReceived) {
        this.deps.onUsageReceived(streamingResponse.usage);
      }

      // Pillar 2: Anchor local estimate using prompt_tokens returned by the API
      if (streamingResponse.usage?.promptTokens && this.deps.anchorTokenEstimate) {
        this.deps.anchorTokenEstimate(streamingResponse.usage.promptTokens);
      }

      this.deps.setChatStatus(ChatStatus.RECEIVED_RESPONSE);

      const hasToolCalls = !!(response.tool_calls && response.tool_calls.length > 0);
      const truncatedToolCallIds = new Set<string>();
      const responseText = MessageHelper.getText(response).trimEnd();

      if (hasToolCalls) {
        const normalizedToolCalls = normalizeToolCalls(response.tool_calls);
        if (normalizedToolCalls) {
          response.tool_calls = normalizedToolCalls;
        }

        if (streamingResponse.finishReason === 'length' && response.tool_calls) {
          const truncatedToolCalls = detectTruncatedToolCalls(response.tool_calls);
          if (truncatedToolCalls.length > 0) {
            logger.warn('[AgentChat] Detected truncated tool call(s) in streaming response', 'startChat', {
              agentName: this.deps.getAgentName(),
              finishReason: streamingResponse.finishReason,
              truncatedToolCount: truncatedToolCalls.length,
              toolNames: truncatedToolCalls.map((toolCall) => toolCall.function?.name || 'unknown'),
            });

            truncatedToolCalls.forEach((toolCall) => {
              if (toolCall.id) {
                truncatedToolCallIds.add(toolCall.id);
              }
            });

            const { toolCalls: sanitizedToolCalls } = sanitizeToolCallsForApi(response.tool_calls);
            response.tool_calls = sanitizedToolCalls;
          }
        }

        await this.deps.addMessageToSession(response);
      } else if (responseText) {
        await this.deps.addMessageToSession(response);
      }

      if (hasToolCalls && response.tool_calls) {
        await this.handleToolCalls(response, truncatedToolCallIds, token, executionNonce);
        requiresFollowUp = true;
      } else {
        this.throwIfCancelled(token, 'before storage compression');
        await this.applyStorageCompressionAndRecalculate();
        await this.deps.extractFactsFromConversation();
        requiresFollowUp = false;
        this.deps.setChatStatus(ChatStatus.IDLE);
      }
    }
  }

  private async callWithOverflowRecovery(token?: CancellationToken): Promise<StreamingApiResponse> {
    this.deps.setChatStatus(ChatStatus.SENDING_RESPONSE);

    try {
      return await this.deps.callWithToolsStreaming(token);
    } catch (error) {
      if (!this.isContextOverflowError(error)) {
        throw error;
      }

      logger.warn('[AgentChat] Context overflow detected, attempting one forced compaction retry', 'startChat', {
        agentName: this.deps.getAgentName(),
        chatSessionId: this.deps.getChatSessionId(),
        error: error instanceof Error ? error.message : String(error),
      });

      const { applied } = await this.deps.checkAndCompress({ force: true });
      if (!applied) {
        // Re-throw the original provider overflow error so callers see the real root cause
        // when forced compaction produced no installable result.
        logger.warn('[AgentChat] Forced compaction produced no installable result; overflow retry skipped', 'startChat', {
          agentName: this.deps.getAgentName(),
          chatSessionId: this.deps.getChatSessionId(),
        });
        throw error;
      }

      this.throwIfCancelled(token, 'after overflow recovery compaction');
      this.deps.setChatStatus(ChatStatus.SENDING_RESPONSE);
      return await this.deps.callWithToolsStreaming(token);
    }
  }

  private isContextOverflowError(error: unknown): boolean {
    if (!(error instanceof GhcApiError)) {
      return false;
    }

    const message = error.message || '';
    return AgentChatTurnRunner.OVERFLOW_ERROR_PATTERNS.some((pattern) => pattern.test(message));
  }

  async handleFailure(error: unknown): Promise<void> {
    if (error instanceof CancellationError) {
      logger.info('[AgentChat] Handling cancellation', 'startChat', {
        agentName: this.deps.getAgentName(),
      });

      await this.deps.cleanupIncompleteToolCalls();
      this.deps.resetMessagesToSave();
      this.deps.setChatStatus(ChatStatus.IDLE);
      this.deps.clearOutput();
      return;
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`[AgentChat] Unified streaming processing failed: ${errorMessage}`);
    this.deps.setChatStatus(ChatStatus.IDLE);
    this.deps.clearOutput();
  }

  private throwIfCancelled(token: CancellationToken | undefined, stage: string): void {
    if (!token?.isCancellationRequested) {
      return;
    }

    logger.info('[AgentChat] 🛑 Cancellation detected', 'startChat', {
      agentName: this.deps.getAgentName(),
      stage,
    });
    throw new CancellationError(`Operation cancelled ${stage}`);
  }

  private async handleToolCalls(
    response: AssistantMessage,
    truncatedToolCallIds: Set<string>,
    token: CancellationToken | undefined,
    executionNonce: number,
  ): Promise<void> {
    const toolCallsForExecution = response.tool_calls!.filter(
      (toolCall) => !truncatedToolCallIds.has(toolCall.id),
    );

    this.throwIfCancelled(token, 'before tool validation');

    const approvalMap = toolCallsForExecution.length > 0
      ? await this.deps.batchValidateAndRequestApproval(toolCallsForExecution)
      : new Map<string, boolean>();

    this.throwIfCancelled(token, 'after tool validation');

    for (const toolCall of toolCallsForExecution) {
      this.throwIfCancelled(token, 'during tool execution');

      const toolName = toolCall.function.name;
      const approved = approvalMap.get(toolCall.id);

      logger.info('[AgentChat] 🔧 Executing tool call', 'startChat', {
        toolCallId: toolCall.id,
        toolName,
        approved,
        approvalMapHasKey: approvalMap.has(toolCall.id),
        approvalMapSize: approvalMap.size,
        approvalMapEntries: Array.from(approvalMap.entries()),
        agentName: this.deps.getAgentName(),
      });

      try {
        const toolResult = await this.deps.executeToolCall(toolCall, approved);
        this.deps.assertExecutionActive(token, executionNonce, `tool execution: ${toolName}`);
        const postProcessedResult = await this.deps.postProcessToolResult(toolCall, toolResult);
        this.deps.assertExecutionActive(token, executionNonce, `tool post-processing: ${toolName}`);

        await this.persistToolResult(toolCall, toolResult, postProcessedResult, token, executionNonce);
      } catch (error) {
        if (error instanceof CancellationError) {
          logger.info('[AgentChat] Dropping tool failure persistence after cancellation', 'startChat', {
            toolCallId: toolCall.id,
            toolName,
            agentName: this.deps.getAgentName(),
          });
          throw error;
        }

        if (isNonInteractiveRuntimeInteractionError(error)) {
          logger.warn('[AgentChat] Failing turn after blocked interactive request in non-interactive runtime', 'startChat', {
            toolCallId: toolCall.id,
            toolName,
            agentName: this.deps.getAgentName(),
            chatSessionId: this.deps.getChatSessionId(),
            policy: error.details.policy,
            requestType: error.details.requestType,
          });
          await this.persistToolExecutionFailure(toolCall, toolName, error, token, executionNonce);
          throw error;
        }

        logger.error(`[AgentChat] Tool execution failed: ${error instanceof Error ? error.message : String(error)}`);
        await this.persistToolExecutionFailure(toolCall, toolName, error, token, executionNonce);
      }
    }

    if (truncatedToolCallIds.size > 0) {
      await this.persistTruncatedToolErrors(response, truncatedToolCallIds);
    }
  }

  private async persistToolResult(
    toolCall: any,
    toolResult: any,
    postProcessedResult: any,
    token: CancellationToken | undefined,
    executionNonce: number,
  ): Promise<void> {
    const toolName = toolCall.function.name;
    const processedContent = typeof postProcessedResult === 'object'
      ? JSON.stringify(postProcessedResult, null, 2)
      : String(postProcessedResult);

    const isErrorResult = typeof toolResult === 'object' && (
      toolResult.denied === true ||
      toolResult.truncated === true ||
      toolResult.parseError === true ||
      toolResult.success === false
    );

    let mcpImageData: { data: string; mimeType: string } | null = null;
    let sanitizedContent = processedContent;

    try {
      const parsed = JSON.parse(processedContent);
      if (parsed && parsed.type === 'image' && parsed.data && parsed.mimeType) {
        logger.info('[AgentChat] 🖼️ MCP Image detected in tool result', 'startChat', {
          toolName,
          toolCallId: toolCall.id,
          mimeType: parsed.mimeType,
          dataLength: parsed.data.length,
        });

        mcpImageData = {
          data: parsed.data,
          mimeType: parsed.mimeType,
        };

        sanitizedContent = JSON.stringify({
          type: 'image',
          mimeType: parsed.mimeType,
          description: '[Image returned, raw image data removed from tool result to avoid context bloat]',
        }, null, 2);
      }
    } catch {
      // Ignore non-JSON tool results.
    }

    const toolResponse: Message = MessageHelper.createToolMessage(
      sanitizedContent,
      toolCall.id,
      toolName,
      toolCall.id,
    );

    this.deps.assertExecutionActive(token, executionNonce, `tool result persistence: ${toolName}`);
    await this.deps.addMessageToSession(toolResponse);

    if (mcpImageData) {
      const imageHash = this.deps.createMcpImageHash(mcpImageData.data, mcpImageData.mimeType);
      if (!this.deps.hasInjectedMcpImageHash(imageHash)) {
        const actualFileSize = Math.ceil(mcpImageData.data.length * 3 / 4);
        const imageMessage: UserMessage = {
          id: `user_img_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          role: 'user',
          timestamp: Date.now(),
          content: [
            { type: 'text', text: AUTO_INJECTED_TOOL_IMAGE_TEXT },
            {
              type: 'image',
              image_url: {
                url: `data:${mcpImageData.mimeType};base64,${mcpImageData.data}`,
                detail: 'auto',
              },
              metadata: {
                fileName: `screenshot_${Date.now()}.${mcpImageData.mimeType.split('/')[1] || 'jpg'}`,
                fileSize: actualFileSize,
                mimeType: mcpImageData.mimeType,
                autoInjectedToolResultHash: imageHash,
              },
            } as any,
          ],
        };

        this.deps.assertExecutionActive(token, executionNonce, `tool image injection: ${toolName}`);
        await this.deps.addMessageToSession(imageMessage);
      }
    }

    this.deps.assertExecutionActive(token, executionNonce, `tool result emit: ${toolName}`);
    this.deps.emitStreamingChunk({
      chunkId: `tool_result_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      messageId: toolCall.id,
      chatId: this.deps.getChatId(),
      chatSessionId: this.deps.getChatSessionId(),
      timestamp: Date.now(),
      type: 'tool_result',
      toolResult: {
        tool_call_id: toolCall.id,
        tool_name: toolName,
        content: sanitizedContent,
        isError: isErrorResult,
      },
    });
  }

  private async persistToolExecutionFailure(
    toolCall: any,
    toolName: string,
    error: unknown,
    token: CancellationToken | undefined,
    executionNonce: number,
  ): Promise<void> {
    const errorContent = JSON.stringify({
      error: `Tool execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      tool_call_id: toolCall.id,
      tool_name: toolName,
    }, null, 2);

    const errorResponse: Message = MessageHelper.createToolMessage(
      errorContent,
      toolCall.id,
      toolName,
      `${toolCall.id}_error`,
    );

    this.deps.assertExecutionActive(token, executionNonce, `tool failure persistence: ${toolName}`);
    await this.deps.addMessageToSession(errorResponse);
    this.deps.assertExecutionActive(token, executionNonce, `tool failure emit: ${toolName}`);
    this.deps.emitStreamingChunk({
      chunkId: `tool_result_error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      messageId: toolCall.id,
      chatId: this.deps.getChatId(),
      chatSessionId: this.deps.getChatSessionId(),
      timestamp: Date.now(),
      type: 'tool_result',
      toolResult: {
        tool_call_id: toolCall.id,
        tool_name: toolName,
        content: errorContent,
        isError: true,
      },
    });
  }

  private async persistTruncatedToolErrors(response: AssistantMessage, truncatedToolCallIds: Set<string>): Promise<void> {
    const truncatedToolCalls = response.tool_calls!.filter((toolCall) => truncatedToolCallIds.has(toolCall.id));

    for (const toolCall of truncatedToolCalls) {
      const toolName = toolCall.function?.name || 'unknown';
      const errorContent = JSON.stringify({
        error: 'Tool arguments were truncated before execution',
        message: `The '${toolName}' tool call was skipped because the model output ended before its arguments completed. Please retry with shorter content. If writing a file, split it into multiple smaller write_file calls or reduce the content size.`,
        tool_call_id: toolCall.id,
        tool_name: toolName,
        truncated: true,
      }, null, 2);

      const errorResponse: Message = MessageHelper.createToolMessage(
        errorContent,
        toolCall.id,
        toolName,
        `${toolCall.id}_truncated`,
      );

      await this.deps.addMessageToSession(errorResponse);
      this.deps.emitStreamingChunk({
        chunkId: `tool_result_error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        messageId: toolCall.id,
        chatId: this.deps.getChatId(),
        chatSessionId: this.deps.getChatSessionId(),
        timestamp: Date.now(),
        type: 'tool_result',
        toolResult: {
          tool_call_id: toolCall.id,
          tool_name: toolName,
          content: errorContent,
          isError: true,
        },
      });
    }
  }

  /**
   * Detect a `StreamCancellationError` (raised by the streaming layer when the user
   * clicks Stop mid-stream) without a value-level import — the streaming service module
   * pulls in chatSessionStore which breaks unit tests that mock the unified logger.
   * We rely on the error's `name` tag and the shape of `partialResponse`.
   */
  private extractPartialResponseFromCancellation(error: unknown): StreamingApiResponse | null {
    if (!error || typeof error !== 'object') {
      return null;
    }
    const candidate = error as { name?: string; partialResponse?: unknown };
    if (candidate.name !== 'StreamCancellationError') {
      return null;
    }
    const partial = candidate.partialResponse;
    if (!partial || typeof partial !== 'object') {
      return null;
    }
    const shaped = partial as Partial<StreamingApiResponse>;
    if (!shaped.message || typeof shaped.finishReason !== 'string') {
      return null;
    }
    return shaped as StreamingApiResponse;
  }

  /**
   * Persist the partial assistant message produced by a cancelled streaming response.
   *
   * Why: when the user clicks Stop while the model is streaming, the partial text is only
   * present in the renderer cache via streaming chunks — `addMessageToSession` is normally
   * called only after the stream completes successfully. Without this, the partial reply
   * vanishes the moment the user switches sessions or closes the window (the disk file
   * still has the user message, but no assistant message). Saving the partial text here
   * keeps what the user already saw on screen.
   *
    * Skips persistence only when there is no visible text. If a partial response already
    * has text and then starts emitting tool calls, persist the text-only portion and drop
    * the half-emitted tool calls; persisting unmatched tool calls would create orphaned
    * tool-call history and can cause API 400 on retry.
   */
  private async persistPartialResponseOnCancellation(partialResponse: StreamingApiResponse): Promise<void> {
    try {
      const message = partialResponse.message;
      const text = MessageHelper.getText(message).trim();
      const hasToolCalls = !!(message.tool_calls && message.tool_calls.length > 0);

      if (!text) {
        logger.info('[AgentChat] Skip persisting cancelled partial response', 'persistPartialResponseOnCancellation', {
          agentName: this.deps.getAgentName(),
          chatSessionId: this.deps.getChatSessionId(),
          textLength: text.length,
          hasToolCalls,
        });
        return;
      }

      let messageToPersist: Message;
      if (hasToolCalls) {
        const { tool_calls: _discardedToolCalls, ...textOnlyMessage } = message;
        messageToPersist = textOnlyMessage;
      } else {
        messageToPersist = { ...message };
      }

      messageToPersist.model = partialResponse.model || this.deps.getCurrentModelId();
      if (partialResponse.usage) {
        messageToPersist.usage = {
          prompt_tokens: partialResponse.usage.promptTokens,
          completion_tokens: partialResponse.usage.completionTokens,
          total_tokens: partialResponse.usage.totalTokens,
        };
      }

      await this.deps.addMessageToSession(messageToPersist);
      // addMessageToSession schedules a fire-and-forget save. Force-await one more save
      // through the serialized save chain so the partial reply is on disk before
      // cancellation propagates (the user may close the window immediately after Stop).
      await this.deps.saveChatSession();

      logger.info('[AgentChat] ✅ Persisted cancelled partial assistant response', 'persistPartialResponseOnCancellation', {
        agentName: this.deps.getAgentName(),
        chatSessionId: this.deps.getChatSessionId(),
        messageId: messageToPersist.id,
        textLength: text.length,
        discardedPartialToolCalls: hasToolCalls,
      });
    } catch (error) {
      // Never let persistence failures mask the original cancellation.
      logger.warn('[AgentChat] Failed to persist cancelled partial response', 'persistPartialResponseOnCancellation', {
        agentName: this.deps.getAgentName(),
        chatSessionId: this.deps.getChatSessionId(),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async applyStorageCompressionAndRecalculate(): Promise<void> {
    const chatHistory = this.deps.getChatHistory();
    const storageCompressionResult = await applyStorageCompressionToRecentMessages(
      chatHistory,
      this.deps.getAgentName(),
    );

    const currentChatSession = this.deps.getCurrentChatSession();
    if (!storageCompressionResult.success || !storageCompressionResult.compressedMessage || !currentChatSession) {
      return;
    }

    const targetMessageId = storageCompressionResult.compressedMessage.id;
    const chatMessageIndex = currentChatSession.chat_history.findIndex((msg: Message) => msg.id === targetMessageId);
    if (chatMessageIndex !== -1) {
      currentChatSession.chat_history[chatMessageIndex] = { ...storageCompressionResult.compressedMessage };
    }

    const contextMessageIndex = currentChatSession.context_history.findIndex((msg: Message) => msg.id === targetMessageId);
    if (contextMessageIndex !== -1) {
      currentChatSession.context_history[contextMessageIndex] = { ...storageCompressionResult.compressedMessage };
    }

    await this.deps.saveChatSession();
    await this.deps.calculateAndNotifyContext();
  }
}