import { MessageHelper } from '@shared/types/chatTypes';
import { CancellationError, CancellationToken, CancellationTokenStatic } from '../cancellation';
import { createLogger } from '../unifiedLogger';
import { mcpClientManager } from "../mcpRuntime/mcpClientManager";
import { BuiltinToolsManager } from "../mcpRuntime/builtinTools/builtinToolsManager";
import { InactivityTimer, SELF_MANAGED_IDLE_TOOLS, TOOL_IDLE_TIMEOUT_MS, ToolIdleTimeoutError } from "../mcpRuntime/toolTimeoutPolicy";
import type { AgentChatInteractionPolicy } from './agentChatInteractionPolicy';

const logger = createLogger();

export interface AgentChatToolExecutorDeps {
  getAgentName(): string;
  getChatId(): string;
  getChatSessionId(): string;
  getCurrentUserAlias(): string;
  getCurrentCancellationToken(): CancellationToken | undefined;
  getCurrentToolExecutionNonce(): number;
  setCurrentToolExecutionNonce(next: number): void;
  getActiveToolCancellationHandler(): (() => Promise<void> | void) | null;
  setActiveToolCancellationHandler(handler: (() => Promise<void> | void) | null): void;
  getEventSender(): Electron.WebContents | null;
  getInteractionPolicy(): AgentChatInteractionPolicy;
  currentModelSupportsTools(): boolean;
  getCurrentModelId(): string;
  getContextSummary(): string;
  getCurrentChatSession(): import('../userDataADO/chatSessionFileOps').ChatSessionFile | null;
  getCurrentUserMessageId(): string | undefined;
  saveChatSession(): Promise<{ success: boolean; error?: string }>;
  getSkipPersistence(): boolean;
  /** MCP server names bound to the current agent — used for per-agent tool routing */
  getAgentMcpServerNames(): string[];
}

export class AgentChatToolExecutor {
  constructor(private readonly deps: AgentChatToolExecutorDeps) {}

  assertExecutionActive(token: CancellationToken | undefined, executionNonce: number, stage: string): void {
    if (token?.isCancellationRequested || executionNonce !== this.deps.getCurrentToolExecutionNonce()) {
      logger.info('[AgentChat] 🛑 Cancellation detected after async boundary', 'assertExecutionActive', {
        agentName: this.deps.getAgentName(),
        stage,
        tokenCancelled: !!token?.isCancellationRequested,
        executionNonce,
        activeNonce: this.deps.getCurrentToolExecutionNonce(),
      });
      throw new CancellationError(`Operation cancelled during ${stage}`);
    }
  }

  invalidateActiveExecution(): void {
    this.deps.setCurrentToolExecutionNonce(this.deps.getCurrentToolExecutionNonce() + 1);
  }

  async cancelActiveToolExecution(): Promise<void> {
    const handler = this.deps.getActiveToolCancellationHandler();
    if (!handler) {
      return;
    }

    this.deps.setActiveToolCancellationHandler(null);

    try {
      await handler();
    } catch (error) {
      logger.warn('[AgentChat] Failed to cancel active tool execution', 'cancelActiveToolExecution', {
        agentName: this.deps.getAgentName(),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  registerActiveToolCancellationHandler(handler: () => Promise<void> | void): { dispose(): void } {
    this.deps.setActiveToolCancellationHandler(handler);
    return {
      dispose: () => {
        if (this.deps.getActiveToolCancellationHandler() === handler) {
          this.deps.setActiveToolCancellationHandler(null);
        }
      },
    };
  }

  async executeToolCall(toolCall: any, approved?: boolean): Promise<any> {
    if (!this.deps.currentModelSupportsTools()) {
      throw new Error(`Model ${this.deps.getCurrentModelId()} does not support tool calls`);
    }

    const { name, arguments: args } = toolCall.function;
    let parsedArgs;

    try {
      if (!args || (typeof args === 'string' && args.trim() === '')) {
        logger.info('[AgentChat] Tool call with empty arguments, using empty object', 'executeToolCall', {
          toolName: name,
          toolCallId: toolCall.id,
          argsType: typeof args,
          argsValue: args,
        });
        parsedArgs = {};
      } else {
        const trimmedArgs = args.trim();
        const openBraces = (trimmedArgs.match(/{/g) || []).length;
        const closeBraces = (trimmedArgs.match(/}/g) || []).length;
        const openBrackets = (trimmedArgs.match(/\[/g) || []).length;
        const closeBrackets = (trimmedArgs.match(/\]/g) || []).length;
        const quoteCount = (trimmedArgs.match(/(?<!\\)"/g) || []).length;
        const hasUnbalancedQuotes = quoteCount % 2 !== 0;

        if (openBraces !== closeBraces || openBrackets !== closeBrackets || hasUnbalancedQuotes) {
          logger.warn('[AgentChat] Detected truncated JSON in tool arguments', 'executeToolCall', {
            toolName: name,
            toolCallId: toolCall.id,
            argsLength: args.length,
            openBraces,
            closeBraces,
            openBrackets,
            closeBrackets,
            hasUnbalancedQuotes,
            argsSample: args.length > 200 ? `${args.substring(0, 100)}...${args.substring(args.length - 100)}` : args,
          });

          return {
            success: false,
            error: 'Tool arguments were truncated',
            message: `The tool call arguments appear to be truncated (incomplete JSON). This usually happens when the content is too large. Please try breaking down the task into smaller parts or use a different approach. Detected: ${openBraces} open braces vs ${closeBraces} close braces, ${openBrackets} open brackets vs ${closeBrackets} close brackets.`,
            tool_call_id: toolCall.id,
            tool_name: name,
            truncated: true,
          };
        }

        parsedArgs = JSON.parse(args);
      }
    } catch (error) {
      logger.error('[AgentChat] Failed to parse tool arguments', 'executeToolCall', {
        toolName: name,
        toolCallId: toolCall.id,
        argsType: typeof args,
        argsValue: args,
        argsLength: args?.length || 0,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        success: false,
        error: 'Invalid tool arguments',
        message: `Failed to parse tool arguments: ${error instanceof Error ? error.message : String(error)}. Please ensure the arguments are valid JSON and try again with corrected parameters.`,
        tool_call_id: toolCall.id,
        tool_name: name,
        parseError: true,
      };
    }

    if (approved === false) {
      logger.warn('[AgentChat] Tool execution denied by user (batch approval)', 'executeToolCall', {
        toolName: name,
        toolCallId: toolCall.id,
      });

      return {
        success: false,
        error: 'Tool execution denied by user',
        message: 'Access to paths outside workspace was rejected by user',
        tool_call_id: toolCall.id,
        tool_name: name,
        denied: true,
      };
    }

    try {

      const abortController = new AbortController();
      const agentMcpServerNames = this.deps.getAgentMcpServerNames();

      // Central no-response watchdog. Every builtin tool (except those in SELF_MANAGED_IDLE_TOOLS,
      // which run their own idle budget internally) is force-terminated after TOOL_IDLE_TIMEOUT_MS
      // elapse with no reported activity. Real tool output resets it through the reportActivity hook
      // injected into the execution context below. Third-party MCP tools self-manage their idle
      // budget inside the MCP client, so they are deliberately NOT gated here.
      const applyIdleWatchdog = mcpClientManager.isBuiltinTool(name, agentMcpServerNames) && !SELF_MANAGED_IDLE_TOOLS.has(name);
      let idleTimer: InactivityTimer | undefined;
      let idleReject: ((reason: unknown) => void) | undefined;
      const idlePromise: Promise<never> | undefined = applyIdleWatchdog
        ? new Promise<never>((_resolve, reject) => { idleReject = reject; })
        : undefined;
      if (applyIdleWatchdog) {
        idleTimer = new InactivityTimer(TOOL_IDLE_TIMEOUT_MS, () => {
          logger.warn('[AgentChat] Tool produced no response within the no-response budget; terminating', 'executeToolCall', {
            toolName: name,
            toolCallId: toolCall.id,
            idleMs: TOOL_IDLE_TIMEOUT_MS,
          });
          // Abort so signal-aware tools tear down their resources, and reject the race so the agent
          // loop unblocks even if a tool ignores the signal.
          abortController.abort(new ToolIdleTimeoutError(name, TOOL_IDLE_TIMEOUT_MS));
          idleReject?.(new ToolIdleTimeoutError(name, TOOL_IDLE_TIMEOUT_MS));
        });
      }
      const watchdog = idleTimer;
      const reportActivity = watchdog ? () => watchdog.touch() : undefined;

      BuiltinToolsManager.setExecutionContext({
        chatSessionId: this.deps.getChatSessionId(),
        chatId: this.deps.getChatId(),
        userAlias: this.deps.getCurrentUserAlias(),
        agentName: this.deps.getAgentName(),
        cancellationToken: this.deps.getCurrentCancellationToken() ?? CancellationTokenStatic.None,
        isSubAgent: false,
        interactionPolicy: this.deps.getInteractionPolicy(),
        getParentContextSummary: async () => this.deps.getContextSummary(),
        eventSender: this.deps.getEventSender() ?? undefined,
        currentToolCallId: toolCall.id,
        chatHistory: this.deps.getCurrentChatSession()?.chat_history,
        currentUserMessageId: this.deps.getCurrentUserMessageId(),
        ensureChatSessionSaved: () => this.deps.saveChatSession(),
        skipPersistence: this.deps.getSkipPersistence(),
        registerCancellationHandler: (handler: () => Promise<void> | void) => this.registerActiveToolCancellationHandler(handler),
        reportActivity,
      });

      try {
        const cancellationToken = this.deps.getCurrentCancellationToken();
        const tokenListener = cancellationToken?.onCancellationRequested(() => {
          abortController.abort();
        });
        const cancellationRegistration = this.registerActiveToolCancellationHandler(() => {
          abortController.abort();
        });

        try {
          const execPromise = mcpClientManager.executeTool({ toolName: name, toolArgs: parsedArgs, signal: abortController.signal, agentMcpServerNames });
          if (!idlePromise) {
            return await execPromise;
          }
          // Swallow a late rejection: once the idle watchdog wins the race, the tool's own promise
          // may still settle (it ignored the signal) and would otherwise be an unhandled rejection.
          execPromise.catch(() => undefined);
          return await Promise.race([execPromise, idlePromise]);
        } finally {
          idleTimer?.dispose();
          tokenListener?.dispose();
          cancellationRegistration.dispose();
        }
      } finally {
        BuiltinToolsManager.clearExecutionContext();
      }
    } catch (error) {
      logger.error(`[AgentChat] MCP tool execution failed: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  async cleanupIncompleteToolCalls(): Promise<void> {
    try {
      const currentChatSession = this.deps.getCurrentChatSession();
      if (!currentChatSession) {
        return;
      }

      const chatHistory = currentChatSession.chat_history;
      const contextHistory = currentChatSession.context_history;
      if (chatHistory.length === 0) {
        return;
      }

      let lastAssistantIndex = -1;
      for (let i = chatHistory.length - 1; i >= 0; i -= 1) {
        const msg = chatHistory[i];
        if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
          lastAssistantIndex = i;
          break;
        }
      }

      if (lastAssistantIndex === -1) {
        return;
      }

      const lastAssistantMessage = chatHistory[lastAssistantIndex];
      if (lastAssistantMessage.role !== 'assistant') return;
      const toolCalls = lastAssistantMessage.tool_calls || [];
      const executedToolCallIds = new Set<string>();
      const unexecutedToolCallIds = new Set<string>();

      for (const toolCall of toolCalls) {
        const hasToolMessage = chatHistory.some((msg, idx) => idx > lastAssistantIndex && msg.role === 'tool' && msg.tool_call_id === toolCall.id);
        if (hasToolMessage) {
          executedToolCallIds.add(toolCall.id);
        } else {
          unexecutedToolCallIds.add(toolCall.id);
        }
      }

      logger.info('[AgentChat] Analyzing tool calls for cleanup', 'cleanupIncompleteToolCalls', {
        agentName: this.deps.getAgentName(),
        totalToolCalls: toolCalls.length,
        executedCount: executedToolCallIds.size,
        unexecutedCount: unexecutedToolCallIds.size,
        executedToolCallIds: Array.from(executedToolCallIds),
        unexecutedToolCallIds: Array.from(unexecutedToolCallIds),
      });

      if (unexecutedToolCallIds.size === 0) {
        logger.info('[AgentChat] All tool calls executed, no cleanup needed', 'cleanupIncompleteToolCalls', {
          agentName: this.deps.getAgentName(),
        });
        return;
      }

      let needsUpdate = false;

      if (executedToolCallIds.size > 0) {
        const executedToolCalls = toolCalls.filter((toolCall) => executedToolCallIds.has(toolCall.id));
        const cleanedMessage = {
          ...lastAssistantMessage,
          tool_calls: executedToolCalls,
        };
        currentChatSession.chat_history[lastAssistantIndex] = cleanedMessage;
        const contextIndex = contextHistory.findIndex((msg) => msg.id === lastAssistantMessage.id);
        if (contextIndex !== -1) {
          currentChatSession.context_history[contextIndex] = cleanedMessage;
        }

        logger.info('[AgentChat] Kept executed tool calls, removed unexecuted ones', 'cleanupIncompleteToolCalls', {
          agentName: this.deps.getAgentName(),
          messageId: lastAssistantMessage.id,
          keptToolCalls: executedToolCallIds.size,
          removedToolCalls: unexecutedToolCallIds.size,
        });
        needsUpdate = true;
      } else {
        const messageContent = MessageHelper.getText(lastAssistantMessage).trim();
        if (!messageContent || messageContent.length === 0) {
          currentChatSession.chat_history.splice(lastAssistantIndex, 1);
          const contextIndex = contextHistory.findIndex((msg) => msg.id === lastAssistantMessage.id);
          if (contextIndex !== -1) {
            currentChatSession.context_history.splice(contextIndex, 1);
          }

          logger.info('[AgentChat] Deleted assistant message with no executed tools and empty content', 'cleanupIncompleteToolCalls', {
            agentName: this.deps.getAgentName(),
            messageId: lastAssistantMessage.id,
            removedToolCalls: unexecutedToolCallIds.size,
          });
          needsUpdate = true;
        } else {
          const cleanedMessage = {
            ...lastAssistantMessage,
            tool_calls: undefined,
          };
          currentChatSession.chat_history[lastAssistantIndex] = cleanedMessage;
          const contextIndex = contextHistory.findIndex((msg) => msg.id === lastAssistantMessage.id);
          if (contextIndex !== -1) {
            currentChatSession.context_history[contextIndex] = cleanedMessage;
          }

          logger.info('[AgentChat] Removed all unexecuted tool calls, kept content', 'cleanupIncompleteToolCalls', {
            agentName: this.deps.getAgentName(),
            messageId: lastAssistantMessage.id,
            removedToolCalls: unexecutedToolCallIds.size,
            contentLength: messageContent.length,
          });
          needsUpdate = true;
        }
      }

      if (needsUpdate) {
        await this.deps.saveChatSession();
        logger.info('[AgentChat] ✅ Cleanup completed and saved', 'cleanupIncompleteToolCalls', {
          agentName: this.deps.getAgentName(),
        });
      }
    } catch (error) {
      logger.error('[AgentChat] Error cleaning up incomplete tool calls', 'cleanupIncompleteToolCalls', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        agentName: this.deps.getAgentName(),
      });
    }
  }
}