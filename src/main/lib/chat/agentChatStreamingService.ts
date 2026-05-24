import { GhcModelCapabilities, OpenAiFunctionTool, ToolMode } from '@shared/types/ghcChatTypes';
import { Message, AssistantMessage, MessageHelper } from '@shared/types/chatTypes';
import { StreamingChunk } from '@shared/types/streamingTypes';
import { CancellationError, CancellationToken } from '../cancellation';
import { GHC_CONFIG } from '../auth/ghcConfig';
import { GhcApiError } from '../utilities/errors';
import { getEndpointForModel } from '../llm/ghcModelApi';
import { buildMaxTokensParam, buildReasoningParams, getDefaultReasoningEffort } from '../llm/ghcModelsManager';
import { createLogger } from '../unifiedLogger';
import {
  convertMcpToolsToOpenAiFormat,
  determineToolChoice,
  formatMessagesForApi,
  hasImageContentInMessages,
  validateToolsRequest,
} from './agentChatUtilities';
import { isFeatureEnabled } from '../featureFlags';
import {
  filterToolsForRequest,
  formatDeferredToolsIndex,
  shouldEnableToolSearch,
  TOOL_SEARCH_TOOL_NAME,
} from './toolSearchFilter';
import { BuiltinToolsManager } from '../mcpRuntime/builtinTools/builtinToolsManager';

const logger = createLogger();

export interface StreamingApiResponse {
  message: AssistantMessage;
  finishReason: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  /** Model ID as reported by the API (canonical name, may differ from user selection) */
  model?: string;
}

/**
 * CancellationError variant raised by the streaming layer that carries the partial
 * response accumulated up to the point of cancellation. Callers can persist the
 * partial assistant message instead of dropping it.
 *
 * Note: only emitted when there was streamed content worth preserving. The carried
 * partialResponse always has finishReason='cancelled' so callers can distinguish.
 */
export class StreamCancellationError extends CancellationError {
  readonly partialResponse: StreamingApiResponse;
  constructor(message: string, partialResponse: StreamingApiResponse) {
    super(message);
    this.name = 'StreamCancellationError';
    this.partialResponse = partialResponse;
  }
}

export interface AgentChatStreamingServiceDeps {
  getAgentName(): string;
  getChatId(): string;
  getChatSessionId(): string;
  getCurrentModelId(): string;
  getCurrentModelConfig(modelId: string): {
    maxTokens: number;
    supportsTemperature: boolean;
    supportsTools: boolean;
    supportsImages: boolean;
    /** User-selected reasoning effort for this chat, when the model supports it. */
    reasoningEffort?: string;
  };
  getModelCapabilities(modelId: string): GhcModelCapabilities;
  getCurrentAvailableTools(): Promise<any[]>;
  getCombinedSystemPromptForCurrentTurn(): Promise<Message[]>;
  getContextHistory(): Message[];
  currentModelSupportsTools(): boolean;
  getSessionFromAuthManager(): Promise<any | null>;
  emitStreamingChunk(chunk: StreamingChunk): void;
  setChatStatus(status: string): void;
}

export class AgentChatStreamingService {
  /** Set before each turn to measure Chat TTFT (message received → first token emitted) */
  turnStartTime: number = 0;
  /** Guards against reporting TTFT more than once per user turn (tool-call loops) */
  ttftReportedForTurn: boolean = false;
  /** Tracks seen /responses event types to only log first occurrence of unknown types */
  private seenResponseEventTypes: Set<string> = new Set();

  constructor(private readonly deps: AgentChatStreamingServiceDeps) {}

  async callWithToolsStreaming(token?: CancellationToken): Promise<StreamingApiResponse> {
    try {
      if (token?.isCancellationRequested) {
        throw new CancellationError('Operation cancelled before API call');
      }

      const currentModelId = this.deps.getCurrentModelId();
      const modelConfig = this.deps.getCurrentModelConfig(currentModelId);
      const modelCapabilities = this.deps.getModelCapabilities(currentModelId);

      let openAiTools: OpenAiFunctionTool[] | undefined;
      let toolChoice: string | { type: 'function'; function: { name: string } } | undefined;

      const currentTools = await this.deps.getCurrentAvailableTools();

      // --- Tool Search: filter deferred tools ---
      const toolSearchFeatureEnabled = isFeatureEnabled('openkosmosFeatureToolSearch');
      const toolSearchAutoEnabled = toolSearchFeatureEnabled && shouldEnableToolSearch(currentTools, modelCapabilities.maxContextLength);
      const contextHistory = this.deps.getContextHistory();
      const { filteredTools: toolsForRequest, deferredTools, toolSearchEnabled } =
        filterToolsForRequest(currentTools, contextHistory, { enabled: toolSearchAutoEnabled });

      // Set deferred tools context so ToolSearchTool can access them during execution
      const chatSessionId = this.deps.getChatSessionId();
      if (toolSearchEnabled) {
        BuiltinToolsManager.setDeferredToolsContext(chatSessionId, deferredTools);
      } else {
        BuiltinToolsManager.clearDeferredToolsContext(chatSessionId);
      }

      if (modelCapabilities.supportsTools && toolsForRequest.length > 0) {
        try {
          openAiTools = convertMcpToolsToOpenAiFormat(toolsForRequest);
          validateToolsRequest(openAiTools);
          toolChoice = determineToolChoice(openAiTools, ToolMode.Auto);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.error(`[AgentChat] Tool processing failed: ${errorMessage}`);
          // Tool limit exceeded is a fatal error — the agent cannot function without tools.
          // Re-throw with user-friendly message so it surfaces in the ErrorBar.
          if (errorMessage.includes('Cannot have more than 128 tools')) {
            const toolCount = openAiTools?.length || currentTools.length;
            throw new GhcApiError(
              `Tool limit exceeded: this agent has ${toolCount} tools, but the maximum is 128. Please disconnect some MCP servers and retry.`,
              400
            );
          }
          openAiTools = undefined;
          toolChoice = undefined;
        }
      }

      const systemMessages = await this.deps.getCombinedSystemPromptForCurrentTurn();
      const supportsTools = this.deps.currentModelSupportsTools();
      const endpoint = getEndpointForModel(currentModelId);

      const formattedMessages = await formatMessagesForApi(
        systemMessages,
        contextHistory,
        supportsTools,
        endpoint,
      );

      // Inject deferred tools index so the LLM knows what's available to search
      if (toolSearchEnabled && deferredTools.length > 0) {
        const deferredIndex = formatDeferredToolsIndex(deferredTools);
        // Prepend as a system-level message after the system prompt
        formattedMessages.splice(1, 0, { role: 'user', content: deferredIndex });

        logger.info('[AgentChat] Tool search active', 'callWithToolsStreaming', {
          totalTools: currentTools.length,
          deferredCount: deferredTools.length,
          inlineCount: toolsForRequest.length,
          discoveredCount: toolsForRequest.length - (currentTools.length - deferredTools.length),
        });
      }

      const imageBlocks = formattedMessages.flatMap((message: any) => Array.isArray(message.content) ? message.content.filter((content: any) => content.type === 'image_url') : []);
      if (imageBlocks.length > 0) {
        console.log('[AgentChat] 📊 API payload image stats', {
          totalMessages: formattedMessages.length,
          imageCount: imageBlocks.length,
          totalBase64Bytes: imageBlocks.reduce((sum: number, content: any) => sum + (content.image_url?.url?.length || 0), 0),
        });
      }

      const requestOptions: any = {
        model: currentModelId,
        messages: formattedMessages,
        _maxTokensValue: modelConfig.maxTokens,
        temperature: modelConfig.supportsTemperature ? 0.7 : undefined,
        stream: true,
      };

      // Carry the requested reasoning effort through to makeStreamingApiCall so the
      // request fragment can be shaped per-endpoint (/chat/completions vs /responses).
      if (modelConfig.reasoningEffort) {
        requestOptions._reasoningEffort = modelConfig.reasoningEffort;
      }

      if (openAiTools && openAiTools.length > 0) {
        requestOptions.tools = openAiTools;
        if (toolChoice) {
          requestOptions.tool_choice = toolChoice;
        }
      }

      return await this.makeStreamingApiCall(requestOptions, token);
    } catch (error) {
      if (error instanceof CancellationError) {
        throw error;
      }

      const originalMessage = error instanceof Error ? error.message : 'Streaming call failed';
      const originalStatusCode = error instanceof GhcApiError ? (error as GhcApiError).statusCode : 500;

      logger.error(`[AgentChat] Streaming call failed: ${originalMessage}`, 'callWithToolsStreaming', {
        statusCode: originalStatusCode,
        model: this.deps.getCurrentModelId(),
        agentName: this.deps.getAgentName(),
      });
      throw new GhcApiError(originalMessage, originalStatusCode);
    }
  }

  async makeStreamingApiCall(requestOptions: any, token?: CancellationToken): Promise<StreamingApiResponse> {
    const session = await this.deps.getSessionFromAuthManager();
    if (!session) {
      throw new GhcApiError('No GitHub Copilot session available', 401);
    }

    const currentModelId = this.deps.getCurrentModelId();
    const endpoint = getEndpointForModel(currentModelId);
    const url = `${GHC_CONFIG.API_ENDPOINT}${endpoint}`;
    const hasImageContent = hasImageContentInMessages(requestOptions.messages);

    // Extract the raw max-tokens value and strip the internal-only key
    const maxTokensValue = requestOptions._maxTokensValue;
    const reasoningEffort = requestOptions._reasoningEffort;
    const { _maxTokensValue, _reasoningEffort, ...cleanedOptions } = requestOptions;

    const capabilities = this.deps.getModelCapabilities(currentModelId);
    const defaultEffort = getDefaultReasoningEffort(currentModelId, capabilities.reasoningEfforts ?? []);
    const reasoningFragment = buildReasoningParams({
      endpoint,
      supportedEfforts: capabilities.reasoningEfforts,
      reasoningEffort,
      defaultEffort,
    });

    // Diagnostic log so users can confirm the selected reasoning_effort actually reached the API.
    // `requested` is what the chat persisted; `applied` reflects what the request body will carry
    // (empty fragment = model didn't advertise the level → server default applies).
    if (reasoningEffort || (capabilities.reasoningEfforts && capabilities.reasoningEfforts.length > 0)) {
      logger.info(
        `[AgentChat] 🧠 reasoning_effort | model=${currentModelId} endpoint=${endpoint} ` +
        `requested=${reasoningEffort ?? '(none)'} ` +
        `supported=[${capabilities.reasoningEfforts?.join(',') ?? ''}] ` +
        `applied=${JSON.stringify(reasoningFragment)}`,
        'makeStreamingApiCall',
        { messageId: `pending_${Date.now()}` }
      );
    }

    let requestBody: any;
    if (endpoint === '/responses') {
      requestBody = {
        model: cleanedOptions.model,
        input: cleanedOptions.messages,
        ...buildMaxTokensParam(currentModelId, maxTokensValue),
        ...reasoningFragment,
        stream: cleanedOptions.stream,
        include: ['reasoning.encrypted_content'],
      };

      if (cleanedOptions.tools && cleanedOptions.tools.length > 0) {
        requestBody.tools = cleanedOptions.tools.map((tool: any) => ({
          type: 'function',
          name: tool.function.name,
          description: tool.function.description,
          parameters: tool.function.parameters,
          strict: false,
        }));

        if (cleanedOptions.tool_choice) {
          if (typeof cleanedOptions.tool_choice === 'object') {
            requestBody.tool_choice = {
              type: 'function',
              name: cleanedOptions.tool_choice.function.name,
            };
          } else {
            requestBody.tool_choice = cleanedOptions.tool_choice;
          }
        }
      }
    } else {
      // /chat/completions: request usage in the final streaming chunk
      requestBody = {
        ...cleanedOptions,
        ...buildMaxTokensParam(currentModelId, maxTokensValue),
        ...reasoningFragment,
        stream_options: { include_usage: true },
      };
    }

    const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    let chunkCounter = 0;
    const abortController = new AbortController();

    // Streaming state lifted out of try{} so the outer catch (e.g. AbortError) can
    // include accumulated content in a StreamCancellationError for downstream persistence.
    let fullContent = '';
    let toolCalls: any[] = [];
    let usage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined;
    let apiModel: string | undefined;
    let firstTokenReported = false;
    let fetchStartTime = 0;

    let cancellationListener: { dispose(): void } | null = null;
    if (token) {
      cancellationListener = token.onCancellationRequested(() => {
        logger.info('[AgentChat] 🛑 Aborting fetch request due to cancellation', 'makeStreamingApiCall', {
          messageId,
          agentName: this.deps.getAgentName(),
        });
        abortController.abort();
      });
    }

    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${session.accessToken}`,
        'Content-Type': 'application/json',
        'User-Agent': GHC_CONFIG.USER_AGENT,
        'Editor-Version': GHC_CONFIG.EDITOR_VERSION,
        'Editor-Plugin-Version': GHC_CONFIG.EDITOR_PLUGIN_VERSION,
      };

      if (hasImageContent) {
        headers['Copilot-Vision-Request'] = 'true';
      }

      fetchStartTime = Date.now();
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        signal: abortController.signal,
      });

      if (!response.ok) {
        let errorBody = '';
        let errorMessage = '';
        try {
          errorBody = await response.text();
          try {
            const errorJson = JSON.parse(errorBody);
            errorMessage = errorJson.error?.message || errorJson.message || errorJson.error || errorBody;
          } catch {
            errorMessage = errorBody || response.statusText;
          }
        } catch {
          errorMessage = response.statusText || 'Failed to read error response';
        }

        logger.error('[AgentChat] ❌ API ERROR - Request failed', 'makeStreamingApiCall', {
          agentName: this.deps.getAgentName(),
          status: response.status,
          statusText: response.statusText,
          errorBody,
          errorMessage,
          requestModel: requestOptions.model,
          hasImageContent,
        });

        let userFriendlyMessage = errorMessage || `HTTP ${response.status}`;
        const requestContext = `[Model: ${requestOptions.model}, Endpoint: ${endpoint}, Status: ${response.status}]`;

        if (response.status === 500) {
          userFriendlyMessage = `${requestContext} ${userFriendlyMessage}\n\nCause: Server internal error - the API encountered an unexpected condition\nSuggestion: This may be caused by overly long context or truncated tool calls. Try starting a new conversation or simplifying the request`;
        } else if (response.status === 502 || response.status === 503 || response.status === 504) {
          userFriendlyMessage = `${requestContext} ${userFriendlyMessage}\n\nCause: GitHub Copilot API service is temporarily unstable\nSuggestion: Please try again later`;
        } else if (response.status === 401) {
          userFriendlyMessage = `${requestContext} ${userFriendlyMessage}\n\nCause: Authentication expired\nSuggestion: Please sign in again`;
        } else if (response.status === 403) {
          userFriendlyMessage = `${requestContext} ${userFriendlyMessage}\n\nCause: Access denied\nSuggestion: Please check your Copilot subscription status`;
        } else if (response.status === 429) {
          userFriendlyMessage = `${requestContext} ${userFriendlyMessage}\n\nCause: Too many requests\nSuggestion: Please try again later`;
        } else {
          userFriendlyMessage = `${requestContext} ${userFriendlyMessage}`;
        }

        throw new GhcApiError(userFriendlyMessage, response.status);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new GhcApiError('Failed to get response stream reader', 500);
      }

      let finishReason = '';
      const decoder = new TextDecoder();
      let buffer = '';
      let isCancelled = false;

      try {
        while (true) {
          if (token?.isCancellationRequested) {
            logger.info('[AgentChat] 🛑 Cancellation detected during streaming', 'makeStreamingApiCall', {
              messageId,
              agentName: this.deps.getAgentName(),
              partialContentLength: fullContent.length,
            });
            isCancelled = true;
            reader.cancel();
            throw this.buildStreamCancellationError(
              'Operation cancelled during streaming',
              { messageId, fullContent, toolCalls, usage, apiModel },
            );
          }

          const { done, value } = await reader.read();
          if (done) {
            if (buffer.trim()) {
              const trimmed = buffer.trim();
              if (trimmed.startsWith('data: ') && trimmed !== 'data: [DONE]') {
                try {
                  const data = JSON.parse(trimmed.slice(6));
                  if (!isCancelled) {
                    const prevContent = fullContent;
                    const prevToolCallsLen = toolCalls.length;
                    const nextState = this.processSseData({
                      data,
                      endpoint,
                      fullContent,
                      toolCalls,
                      finishReason,
                      messageId,
                      chunkCounter,
                      usage,
                      apiModel,
                    });
                    fullContent = nextState.fullContent;
                    toolCalls = nextState.toolCalls;
                    finishReason = nextState.finishReason;
                    chunkCounter = nextState.chunkCounter;
                    usage = nextState.usage;
                    apiModel = nextState.apiModel;

                    // Report TTFT on first content or tool_call token (final buffer edge case)
                    if (!firstTokenReported && (
                      (prevContent === '' && fullContent !== '') ||
                      (prevToolCallsLen === 0 && toolCalls.length > 0)
                    )) {
                      firstTokenReported = true;
                      if (!this.ttftReportedForTurn) {
                        this.ttftReportedForTurn = true;
                        if (this.turnStartTime > 0) {
                          this.turnStartTime = 0;
                        }
                      }
                    }
                  }
                } catch {
                  logger.warn(`[AgentChat] Failed to parse final buffer chunk: ${buffer}`);
                }
              }
            }
            break;
          }

          const chunk = decoder.decode(value, { stream: true });
          buffer += chunk;

          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed === '' || trimmed === 'data: [DONE]') continue;
            if (!trimmed.startsWith('data: ')) continue;

            try {
              const data = JSON.parse(trimmed.slice(6));
              if (isCancelled) {
                continue;
              }

              const prevContent = fullContent;
              const prevToolCallsLen = toolCalls.length;
              const nextState = this.processSseData({
                data,
                endpoint,
                fullContent,
                toolCalls,
                finishReason,
                messageId,
                chunkCounter,
                usage,
                apiModel,
              });
              fullContent = nextState.fullContent;
              toolCalls = nextState.toolCalls;
              finishReason = nextState.finishReason;
              chunkCounter = nextState.chunkCounter;
              usage = nextState.usage;
              apiModel = nextState.apiModel;

              // Report TTFT on first content or tool_call token
              if (!firstTokenReported && (
                (prevContent === '' && fullContent !== '') ||
                (prevToolCallsLen === 0 && toolCalls.length > 0)
              )) {
                firstTokenReported = true;
                if (!this.ttftReportedForTurn) {
                  this.ttftReportedForTurn = true;
                  const now = Date.now();
                  if (this.turnStartTime > 0) {
                    this.turnStartTime = 0;
                  }
                }
              }
            } catch {
              logger.warn(`[AgentChat] Failed to parse streaming chunk: ${trimmed}`);
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      const result: Message = MessageHelper.createTextMessage(fullContent, 'assistant', messageId);
      if (toolCalls.length > 0) {
        result.tool_calls = toolCalls.filter((toolCall) => toolCall && toolCall.id);
      }

      this.deps.emitStreamingChunk({
        chunkId: `${messageId}_complete`,
        messageId,
        chatId: this.deps.getChatId(),
        chatSessionId: this.deps.getChatSessionId(),
        timestamp: Date.now(),
        type: 'complete',
        complete: {
          messageId,
          hasToolCalls: (result.tool_calls?.length || 0) > 0,
        },
      });

      return {
        message: result,
        finishReason,
        usage,
        model: apiModel,
      };
    } catch (error) {
      if (error instanceof CancellationError) {
        throw error;
      }

      if (error instanceof Error && error.name === 'AbortError') {
        logger.info('[AgentChat] 🛑 Fetch request aborted', 'makeStreamingApiCall', {
          messageId,
          agentName: this.deps.getAgentName(),
          partialContentLength: fullContent.length,
        });
        throw this.buildStreamCancellationError(
          'Fetch request was aborted',
          { messageId, fullContent, toolCalls, usage, apiModel },
        );
      }

      const originalErrorMessage = error instanceof Error ? error.message : String(error);
      const capitalizedErrorMessage = originalErrorMessage.charAt(0).toUpperCase() + originalErrorMessage.slice(1);

      let causeInfo = '';
      if (error instanceof Error) {
        const cause = (error as Error & { cause?: Error }).cause;
        if (cause) {
          causeInfo = cause.message || String(cause);
          if ((cause as Error & { code?: string }).code) {
            causeInfo = `[${(cause as Error & { code?: string }).code}] ${causeInfo}`;
          }
        }
        if ((error as Error & { code?: string }).code) {
          causeInfo = causeInfo ? `${(error as Error & { code?: string }).code} - ${causeInfo}` : (error as Error & { code?: string }).code || '';
        }
      }

      logger.error(`[AgentChat] Network error during streaming: ${originalErrorMessage}`, 'makeStreamingApiCall', {
        errorName: error instanceof Error ? error.name : 'unknown',
        errorMessage: originalErrorMessage,
        errorCause: causeInfo || 'none',
        errorCode: error instanceof Error ? (error as Error & { code?: string }).code : undefined,
        agentName: this.deps.getAgentName(),
        messageId,
      });

      const lowerMsg = originalErrorMessage.toLowerCase();
      let userFriendlyMessage = capitalizedErrorMessage || 'Unknown network error';

      if (lowerMsg.includes('fetch failed') || lowerMsg.includes('enotfound') || lowerMsg.includes('econnrefused') || lowerMsg.includes('etimedout')) {
        userFriendlyMessage = `${capitalizedErrorMessage}\n\nCause: Network connection failed${causeInfo ? ` (${causeInfo})` : ''}\nSuggestion: Please check if VPN is connected, or if network is working properly`;
      } else if (lowerMsg.includes('certificate') || lowerMsg.includes('ssl') || lowerMsg.includes('tls')) {
        userFriendlyMessage = `${capitalizedErrorMessage}\n\nCause: SSL/TLS certificate issue\nSuggestion: Please check if system time is correct, or try switching network`;
      } else if (lowerMsg === 'terminated') {
        const detailedCause = causeInfo || 'Server connection was unexpectedly closed during streaming';
        userFriendlyMessage = `Connection terminated during streaming\n\nCause: ${detailedCause}\nSuggestion: Please check your network/VPN connection and try again`;
      }

      throw new GhcApiError(userFriendlyMessage, 0);
    } finally {
      if (cancellationListener && token) {
        cancellationListener.dispose();
      }
    }
  }

  /**
   * Build a StreamCancellationError carrying the partial response captured up to
   * the point of cancellation. Sets finishReason to 'cancelled' so downstream code
   * can distinguish a cancelled response from a normal one. The carried message
   * mirrors the success-path message shape (createTextMessage + tool_calls).
   */
  private buildStreamCancellationError(
    message: string,
    state: {
      messageId: string;
      fullContent: string;
      toolCalls: any[];
      usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
      apiModel?: string;
    },
  ): StreamCancellationError {
    const partialMessage = MessageHelper.createTextMessage(state.fullContent, 'assistant', state.messageId);
    const validToolCalls = state.toolCalls.filter((toolCall) => toolCall && toolCall.id);
    if (validToolCalls.length > 0) {
      partialMessage.tool_calls = validToolCalls;
    }
    return new StreamCancellationError(message, {
      message: partialMessage,
      finishReason: 'cancelled',
      usage: state.usage,
      model: state.apiModel,
    });
  }

  private processSseData(args: {
    data: any;
    endpoint: string;
    fullContent: string;
    toolCalls: any[];
    finishReason: string;
    messageId: string;
    chunkCounter: number;
    usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
    apiModel?: string;
  }): {
    fullContent: string;
    toolCalls: any[];
    finishReason: string;
    chunkCounter: number;
    usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
    apiModel?: string;
  } {
    let { data, endpoint, fullContent, toolCalls, finishReason, messageId, chunkCounter, usage, apiModel } = args;

    if (endpoint === '/responses') {
      if (data.type === 'response.output_text.delta' && data.delta) {
        const textDelta = data.delta;
        fullContent += textDelta;

        this.deps.emitStreamingChunk({
          chunkId: `${messageId}_chunk_${chunkCounter++}`,
          messageId,
          chatId: this.deps.getChatId(),
          chatSessionId: this.deps.getChatSessionId(),
          timestamp: Date.now(),
          type: 'content',
          contentDelta: { text: textDelta },
        });
      } else if (data.type === 'response.output_item.done' && data.item?.type === 'function_call') {
        const toolCallItem = data.item;
        if (toolCalls.length === 0) {
          this.deps.setChatStatus('received_response');
        }

        const index = toolCalls.length;
        toolCalls[index] = {
          id: toolCallItem.call_id,
          type: 'function',
          function: {
            name: toolCallItem.name,
            arguments: toolCallItem.arguments,
          },
        };

        this.deps.emitStreamingChunk({
          chunkId: `${messageId}_chunk_${chunkCounter++}`,
          messageId,
          chatId: this.deps.getChatId(),
          chatSessionId: this.deps.getChatSessionId(),
          timestamp: Date.now(),
          type: 'tool_call',
          toolCallDelta: {
            index,
            id: toolCallItem.call_id,
            type: 'function',
            function: {
              name: toolCallItem.name,
              arguments: toolCallItem.arguments,
            },
          },
        });
      } else if (data.type === 'response.completed') {
        const hasFunctionCall = data.response?.output?.some((outputItem: any) => outputItem.type === 'function_call');
        finishReason = hasFunctionCall ? 'tool_calls' : 'stop';

        // Extract token usage and model from response.completed event
        if (data.response?.usage) {
          const u = data.response.usage;
          usage = {
            promptTokens: u.prompt_tokens ?? u.promptTokens ?? 0,
            completionTokens: u.completion_tokens ?? u.completionTokens ?? 0,
            totalTokens: u.total_tokens ?? u.totalTokens ?? 0,
          };
        }
        if (typeof data.response?.model === 'string') {
          apiModel = data.response.model;
        }
      } else if (data.type !== 'response.output_text.delta' && data.type !== 'response.in_progress' && data.type !== 'response.created' && data.type !== 'response.completed' && data.type !== 'response.output_item.done' && data.type !== 'response.function_call_arguments.delta') {
        // Only log the first occurrence of each unknown event type to avoid flooding
        if (!this.seenResponseEventTypes.has(data.type)) {
          this.seenResponseEventTypes.add(data.type);
          logger.info('[AgentChat] 🔍 /responses unknown event type (first occurrence)', 'makeStreamingApiCall', {
            type: data.type,
            keys: Object.keys(data),
          });
        }
      }
    } else if (data.choices && data.choices[0] && data.choices[0].delta) {
      const choice = data.choices[0];
      const delta = choice.delta;

      if (delta.content) {
        fullContent += delta.content;
        if (fullContent === delta.content) {
          this.deps.setChatStatus('received_response');
        }

        this.deps.emitStreamingChunk({
          chunkId: `${messageId}_chunk_${chunkCounter++}`,
          messageId,
          chatId: this.deps.getChatId(),
          chatSessionId: this.deps.getChatSessionId(),
          timestamp: Date.now(),
          type: 'content',
          contentDelta: { text: delta.content },
        });
      }

      if (delta.tool_calls) {
        if (toolCalls.length === 0 && delta.tool_calls.length > 0) {
          this.deps.setChatStatus('received_response');
        }

        for (const toolCall of delta.tool_calls) {
          const index = toolCall.index || 0;
          if (!toolCalls[index]) {
            toolCalls[index] = {
              id: toolCall.id || '',
              type: 'function',
              function: { name: '', arguments: '' },
            };
          }

          if (toolCall.id) toolCalls[index].id = toolCall.id;
          if (toolCall.function?.name) toolCalls[index].function.name = toolCall.function.name;
          if (toolCall.function?.arguments) toolCalls[index].function.arguments += toolCall.function.arguments;

          this.deps.emitStreamingChunk({
            chunkId: `${messageId}_chunk_${chunkCounter++}`,
            messageId,
            chatId: this.deps.getChatId(),
            chatSessionId: this.deps.getChatSessionId(),
            timestamp: Date.now(),
            type: 'tool_call',
            toolCallDelta: {
              index,
              id: toolCall.id,
              type: 'function',
              function: {
                name: toolCall.function?.name,
                arguments: toolCall.function?.arguments,
              },
            },
          });
        }
      }

      if (choice.finish_reason) {
        finishReason = choice.finish_reason;
      }

      // Extract token usage from chat/completions chunk (may appear alongside delta)
      if (data.usage) {
        usage = {
          promptTokens: data.usage.prompt_tokens ?? data.usage.promptTokens ?? 0,
          completionTokens: data.usage.completion_tokens ?? data.usage.completionTokens ?? 0,
          totalTokens: data.usage.total_tokens ?? data.usage.totalTokens ?? 0,
        };
      }

      // Capture model from API response (canonical name from server)
      if (typeof data.model === 'string') {
        apiModel = data.model;
      }
    } else if (data.usage) {
      // Handle usage-only final chunk from /chat/completions with stream_options.
      // When include_usage is true, the API sends a final chunk with
      // choices: [] (empty) and usage populated. The choices[0].delta branch
      // above won't match, so we catch it here.
      usage = {
        promptTokens: data.usage.prompt_tokens ?? data.usage.promptTokens ?? 0,
        completionTokens: data.usage.completion_tokens ?? data.usage.completionTokens ?? 0,
        totalTokens: data.usage.total_tokens ?? data.usage.totalTokens ?? 0,
      };
      if (typeof data.model === 'string') {
        apiModel = data.model;
      }
    }

    return {
      fullContent,
      toolCalls,
      finishReason,
      chunkCounter,
      usage,
      apiModel,
    };
  }
}