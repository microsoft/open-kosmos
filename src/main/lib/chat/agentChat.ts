// src/main/lib/chat/agentChat.ts
// AgentChat main process version - chat handling customized for Agent instances
import {
  ApprovalRequestItem
} from '../security/securityValidator';

import { app } from 'electron';
import { agentChatManager } from './agentChatManager';

/**
 * Get electron app, supporting mock in test environments
 */
function getElectronApp() {
  try {
    // Check if there is a global mock in the test environment
    if ((global as any).electron?.app) {
      return (global as any).electron.app;
    }

    return app;
  } catch (error) {
    // If electron cannot be imported (e.g., in a test environment), return null
    return null;
  }
}
import {
  GhcCopilotModel,
  GhcApiSettings,
  GhcModelConfig,
  GhcModelCapabilities,
  OpenAiFunctionTool,
  OpenAiFunctionDef,
  ToolMode
} from '@shared/types/ghcChatTypes';
import { Message, StartChatCallbacks, MessageHelper, UserMessage } from '@shared/types/chatTypes';
import { AgentChatPushReceiver } from './agentChatPushReceiver';
import { extractMonthFromChatSessionId } from '../userDataADO/pathUtils';
import {
  ApprovalInteractionRequest,
  ChoiceInteractionOption,
  ChoiceInteractionRequest,
  FormInteractionField,
  FormInteractionRequest,
  InteractionHistoryEntry,
  InteractiveRequest,
  InteractiveResponse,
} from '@shared/types/interactiveRequestTypes';
import type { RequestInteractiveInputArgs, RequestInteractiveInputToolResult } from '@shared/types/requestInteractiveInputTypes';
import { CreateChatSessionParams } from '@shared/types/chatSessionTypes';
import { ChatSessionFile } from '../userDataADO/chatSessionFileOps';
import type { ChatSession } from '../userDataADO/types/profile';
import { GHC_CONFIG } from '../auth/ghcConfig';
import { GhcApiError } from '../utilities/errors';
import {
  getModelById,
  getModelCapabilities,
  getDefaultModel,
  validateModelId,
  getAllOpenKosmosUsedModels
} from '../llm/ghcModelsManager';
import { getEndpointForModel } from '../llm/ghcModelApi';
import { mainAuthManager } from '../auth/authManager';
import type {
  AgentChatInteractionPolicy,
  BlockedInteractionDetails,
} from './agentChatInteractionPolicy';
import { createLogger } from '../unifiedLogger';
import { formatFileSize } from '../utilities/contentUtils';
import { openkosmosPlaceholderManager, containsOpenKosmosPlaceholder } from '../userDataADO/openkosmosPlaceholders';
import { userInputPlaceholderParser, UserInputField } from '../userDataADO/userInputPlaceholderParser';
import { profileCacheManager } from '../userDataADO/profileCacheManager';
import { featureFlagManager, isFeatureEnabled } from '../featureFlags';
import { SubAgentFileManager } from '../subAgent/subAgentFileManager';
import { AgentChatPromptService } from './agentChatPromptService';
import { AgentChatSessionService } from './agentChatSessionService';
import { AgentChatContextService } from './agentChatContextService';
import { AgentChatInteractionService } from './agentChatInteractionService';
import { AgentChatToolPostProcessor } from './agentChatToolPostProcessor';
import { AgentChatToolExecutor } from './agentChatToolExecutor';
import { AgentChatStreamingService, StreamingApiResponse } from './agentChatStreamingService';
import { AgentChatRuntimeState } from './agentChatRuntimeState';
import { AgentChatOutputPort } from './agentChatOutputPort';
import { AgentChatTurnRunner } from './agentChatTurnRunner';
import { ChatStatus, ContextStats, ContextTokenUsage } from './agentChatTypes';

// 🔥 New: Import CancellationToken related types
import { CancellationToken, CancellationError, CancellationTokenStatic } from '../cancellation';

//  New: Token counter module imports
import {
  createTokenCounter,
  TokenCounter,
  type TokenCounterConfig
} from '../token';

// 🔄 New: Compression module imports
import {
  createFullModeCompressor,
  FullModeCompressor,
} from '../compression/fullModeCompressor';

// 🔄 New: Utility method imports
import {
  normalizeToolCalls,
  detectTruncatedToolCalls,
  sanitizeToolCallsForApi,
  applyStorageCompressionToRecentMessages,
} from './agentChatUtilities';
import { createHash } from 'crypto';
import { BuddyManager } from '../buddy/BuddyManager';
import { handleExternalAgentMessage as externalAgentMessageHandler } from './externalAgentChatHandler';

const logger = createLogger();
const AUTO_INJECTED_TOOL_IMAGE_TEXT = '[Image from tool result - automatically injected for vision model]';

// Agent configuration interface
export interface AgentConfig {
  role: string        // "Default Assistant"
  emoji: string       // "🤖"
  name: string        // "OpenKosmos"
  model: string       // "gpt-5"
  reasoningEffort?: string
  mcp_servers: Array<{name: string; tools: string[]}>
  system_prompt: string
  context_enhancement?: Record<string, unknown>;
}

interface UserMessageEditValidationResult {
  canEdit: boolean;
  targetUserIndex: number;
  targetUserMessage: Message | null;
  targetContextUserIndex: number;
  error?: string;
}

export { ChatStatus, type ContextStats, type ContextTokenUsage } from './agentChatTypes';
import { hookRegistry } from "../plugin/hooks/hookRegistry";

// AgentChat class - Main process version
export class AgentChat {
  // 🔥 Refactor: Identity info (including ChatSessionId)
  private currentUserAlias: string
  private chatId: string
  private chatSessionId: string

  // Chat session and UI state
  private currentChatSession: ChatSessionFile | null = null
  private contextChangeListeners: ((stats: ContextStats) => void)[] = []
  private statusChangeListeners: ((status: ChatStatus) => void)[] = []
  private latestContextStats: ContextStats | null = null

  // 🔥 New: Private contextTokenUsage variable for caching the latest context token statistics
  private contextTokenUsage: ContextTokenUsage | null = null

  // 🔥 New: Cache the first user message for deferred title generation
  private firstUserMessage: Message | null = null
  private schedulerJobId?: string
  private skipPersistence: boolean = false
  private schedulerExecutionMetadata: {
    schedulerExecutionStatus?: 'running' | 'completed' | 'failed';
    schedulerStartedAt?: string;
    schedulerCompletedAt?: string;
    schedulerError?: string;
  } = {}

  // 🔄 Optimization: Removed redundant model cache, now fetched directly from ghcModels
  // private availableModels: GhcCopilotModel[] = []  // ❌ Removed
  // private supportedModels: Map<string, GhcCopilotModel> = new Map()  // ❌ Removed

  private outputPort: AgentChatOutputPort

  // Token counting and compression related properties
  private tokenCounter: TokenCounter
  private tokenCounterEncoding: string = 'o200k_base'
  private fullModeCompressor: FullModeCompressor

  // 🔥 New: Message save queue for atomic saving
  // Flag: whether the current turn is from a remote channel
  private isRemoteSession = false
  private interactionPolicy: AgentChatInteractionPolicy = 'allow-ui'
  private blockedInteractionDetails: BlockedInteractionDetails | null = null

  private runtimeState: AgentChatRuntimeState
  private promptService?: AgentChatPromptService
  private sessionService?: AgentChatSessionService
  private contextService?: AgentChatContextService
  private interactionService?: AgentChatInteractionService
  private toolPostProcessor?: AgentChatToolPostProcessor
  private toolExecutor?: AgentChatToolExecutor
  private streamingService?: AgentChatStreamingService
  private turnRunner?: AgentChatTurnRunner

  // 🔌 Plugin hook: tracks whether SessionStart hook has fired for this chat instance
  private sessionStartHookFired = false

  private pushReceiver: AgentChatPushReceiver;

  // 🔥 Refactor: Provide two constructor overloads
  constructor(userAlias: string, chatId: string, chatSessionId: string);
  constructor(userAlias: string, chatId: string, chatSessionId: string, chatSessionData: ChatSessionFile);
  constructor(userAlias: string, chatId: string, chatSessionId: string, chatSessionData?: ChatSessionFile) {
    // 🔥 Refactor: Accept identity info and ChatSessionId (must be provided by AgentChatManager)
    this.currentUserAlias = userAlias
    this.chatId = chatId
    this.chatSessionId = chatSessionId

    // 🔥 Validation: If userAlias is empty, throw an error
    if (!userAlias || userAlias.trim().length === 0) {
      const error = new Error(`Cannot create AgentChat: userAlias is empty or invalid`);
      logger.error('[AgentChat] ❌ CRITICAL: Empty userAlias detected', 'AgentChat.constructor', {
        userAlias,
        chatId,
        chatSessionId,
        error: error.message
      });
      throw error;
    }

    // Validate that config exists
    const config = this.getLatestAgentConfig()
    if (!config) {
      throw new Error(`Cannot create AgentChat: no config found for userAlias=${userAlias}, chatId=${chatId}`)
    }

    // 🔥 Initialize currentChatSession based on whether chatSessionData is provided
    if (chatSessionData) {
      // Case 1: Existing ChatSession data provided, use directly
      this.currentChatSession = {
        ...chatSessionData,
        interaction_history: chatSessionData.interaction_history || [],
      };
      logger.info('[AgentChat] Initialized with existing ChatSession data', 'constructor', {
        userAlias,
        chatId,
        chatSessionId,
        title: chatSessionData.title,
        messagesCount: chatSessionData.chat_history?.length || 0
      });
    } else {
      // Case 2: New ChatSession, create an empty ChatSession
      this.createChatSession({ chatSession_id: chatSessionId });
      logger.info('[AgentChat] Created new ChatSession', 'constructor', {
        userAlias,
        chatId,
        chatSessionId
      });
    }

    // Initialize token counter and compressor
    // Use the model's tokenizer encoder, falling back to o200k_base (aligned with VS Code Copilot)
    const modelId = this.getCurrentModelId();
    const modelCaps = getModelCapabilities(modelId);
    const encoding = modelCaps?.tokenizer || 'o200k_base';
    this.tokenCounterEncoding = encoding;
    this.tokenCounter = createTokenCounter({
      defaultEncoding: encoding,
      enableCache: true,
      cacheSize: 10000
    });

    // Initialize compressor (using default settings)
    this.fullModeCompressor = createFullModeCompressor();
    this.runtimeState = new AgentChatRuntimeState(ChatStatus.IDLE);
    this.outputPort = new AgentChatOutputPort(
      () => this.chatId,
      () => this.chatSessionId,
      () => this.getAgentName(),
    );
    this.promptService = this.createPromptService();
    this.sessionService = this.createSessionService();
    this.contextService = this.createContextService();
    this.interactionService = this.createInteractionService();
    this.toolPostProcessor = this.createToolPostProcessor();
    this.toolExecutor = this.createToolExecutor();
    this.pushReceiver = new AgentChatPushReceiver({
      chatId: this.chatId,
      getChatSessionId: () => this.currentChatSession?.chatSession_id || '',
      setChatStatus: (s) => this.setChatStatus(s === 'sending_response' ? ChatStatus.SENDING_RESPONSE : ChatStatus.IDLE),
      getChatStatus: () => this.getChatStatus(),
      emitStreamingChunk: (chunk) => this.emitStreamingChunk(chunk),
      addMessageToSession: (msg) => this.AddMessageToSession(msg),
    });

    // 🔥 New: Calculate and notify initial context state at the end of constructor
    // Note: This is a synchronous call, but calculateAndNotifyContext is async internally
    // We don't await it, let it execute in the background
    this.calculateAndNotifyContext().catch(error => {
      logger.error('[AgentChat] Failed to calculate initial context in constructor', 'constructor', {
        error: error instanceof Error ? error.message : String(error),
        agentName: this.getAgentName()
      });
    });
  }


  /**
   * 🔥 Helper method: Get agent name (for logging)
   */
  private getAgentName(): string {
    const config = this.getLatestAgentConfig();
    return config?.name || 'Unknown Agent';
  }

  private createPromptService(): AgentChatPromptService {
    return new AgentChatPromptService({
      getCurrentUserAlias: () => this.currentUserAlias,
      getChatId: () => this.chatId,
      getChatSessionId: () => this.chatSessionId,
      getAgentName: () => this.getAgentName(),
      getLatestAgentConfig: () => this.getLatestAgentConfig(),
      isRemoteSession: () => this.isRemoteSession,
      getInteractionPolicy: () => this.interactionPolicy,
    });
  }

  private getPromptService(): AgentChatPromptService {
    if (!this.promptService) {
      this.promptService = this.createPromptService();
    }
    return this.promptService;
  }

  private createSessionService(): AgentChatSessionService {
    return new AgentChatSessionService({
      getCurrentChatSession: () => this.currentChatSession,
      setCurrentChatSession: (session) => {
        this.currentChatSession = session;
      },
      getCurrentUserAlias: () => this.currentUserAlias,
      getChatId: () => this.chatId,
      getChatSessionId: () => this.chatSessionId,
      getAgentName: () => this.getAgentName(),
      getFirstUserMessage: () => this.firstUserMessage,
      setFirstUserMessage: (message) => {
        this.firstUserMessage = message;
      },
      getSchedulerMetadata: () => this.getSchedulerMetadata(),
      getMessagesToSave: () => this.runtimeState.messagesToSave as Message[],
      setMessagesToSave: (messages) => {
        this.runtimeState.setMessagesToSave(messages);
      },
      getSaveChain: () => this.runtimeState.saveChain,
      setSaveChain: (chain) => {
        this.runtimeState.setSaveChain(chain);
      },
      addMessageToChatHistory: (message) => this.addMessageToChatHistory(message),
      addMessageToContext: (message) => this.addMessageToContext(message),
      shouldTrackChatSessionActivatedForUserMessage: (message) => this.shouldTrackChatSessionActivatedForUserMessage(message),
      getChatSessionEntryTypeForUserMessage: (message) => this.getChatSessionEntryTypeForUserMessage(message),
      trackChatSessionActivated: (message, sessionEntryType) => this.trackChatSessionActivated(message, sessionEntryType),
      exitNewChatSessionState: () => this.exitNewChatSessionState(),
      calculateAndNotifyContext: () => this.calculateAndNotifyContext(),
      startChat: (token, callbacks) => this.startChat(token, callbacks),
      getDisplayMessages: () => this.getDisplayMessages(),
      getSkipPersistence: () => this.skipPersistence,
    });
  }

  private getSessionService(): AgentChatSessionService {
    if (!this.sessionService) {
      this.sessionService = this.createSessionService();
    }
    return this.sessionService;
  }

  private createContextService(): AgentChatContextService {
    return new AgentChatContextService({
      getCurrentChatSession: () => this.currentChatSession,
      getCurrentUserAlias: () => this.currentUserAlias,
      getAgentName: () => this.getAgentName(),
      getLatestAgentConfig: () => this.getLatestAgentConfig(),
      getCurrentModelId: () => this.getCurrentModelId(),
      getModelCapabilities: (modelId) => this.getModelCapabilities(modelId),
      getContextHistory: () => this.getContextHistory(),
      getChatHistory: () => this.getChatHistory(),
      getCombinedSystemPromptForCurrentTurn: () => this.getCombinedSystemPromptForCurrentTurn(),
      getCurrentAvailableTools: () => this.getCurrentAvailableTools(),
      getTokenCounter: () => this.getTokenCounter(),
      getFullModeCompressor: () => this.fullModeCompressor,
      setChatStatus: (status) => this.setChatStatus(status),
      setContextHistory: (messages) => {
        if (this.currentChatSession) {
          this.currentChatSession.context_history = messages;
        }
      },
      setLastUpdated: (timestamp) => {
        if (this.currentChatSession) {
          this.currentChatSession.last_updated = timestamp;
        }
      },
      getContextChangeListeners: () => this.contextChangeListeners,
      getLatestContextStats: () => this.latestContextStats,
      setLatestContextStats: (stats) => {
        this.latestContextStats = stats;
      },
      setContextTokenUsage: (usage) => {
        this.contextTokenUsage = usage;
      },
    });
  }

  private getContextService(): AgentChatContextService {
    if (!this.contextService) {
      this.contextService = this.createContextService();
    }
    return this.contextService;
  }

  private createInteractionService(): AgentChatInteractionService {
    return new AgentChatInteractionService({
      getChatId: () => this.chatId,
      getChatSessionId: () => this.chatSessionId,
      getAgentName: () => this.getAgentName(),
      getEventSender: () => this.outputPort.getSender(),
      getCurrentChatSession: () => this.currentChatSession,
      saveChatSession: () => this.saveChatSession(),
      safeEmitEvent: (eventName, data) => this.safeEmitEvent(eventName, data),
      getPendingInteractiveRequest: () => this.runtimeState.pendingInteractiveRequest,
      setPendingInteractiveRequest: (request) => {
        this.runtimeState.setPendingInteractiveRequest(request);
      },
      getInteractionPolicy: () => this.interactionPolicy,
      reportBlockedInteraction: (details) => {
        this.blockedInteractionDetails = details;
      },
    });
  }

  private getInteractionService(): AgentChatInteractionService {
    if (!this.interactionService) {
      this.interactionService = this.createInteractionService();
    }
    return this.interactionService;
  }

  private createToolPostProcessor(): AgentChatToolPostProcessor {
    return new AgentChatToolPostProcessor({
      getAgentName: () => this.getAgentName(),
      getChatId: () => this.chatId,
      getChatSessionId: () => this.chatSessionId,
      isRemoteSession: () => this.isRemoteSession,
      getInteractionPolicy: () => this.interactionPolicy,
      buildInteractionId: (prefix) => this.buildInteractionId(prefix),
      requestUserInteraction: (request, fallbackResponse) => this.requestUserInteraction(request, fallbackResponse),
      requestUserInfoInput: (request) => this.requestUserInfoInput(request),
    });
  }

  private getToolPostProcessor(): AgentChatToolPostProcessor {
    if (!this.toolPostProcessor) {
      this.toolPostProcessor = this.createToolPostProcessor();
    }
    return this.toolPostProcessor;
  }

  private createToolExecutor(): AgentChatToolExecutor {
    return new AgentChatToolExecutor({
      getAgentName: () => this.getAgentName(),
      getChatId: () => this.chatId,
      getChatSessionId: () => this.chatSessionId,
      getCurrentUserAlias: () => this.currentUserAlias,
      getCurrentCancellationToken: () => this.runtimeState.currentCancellationToken,
      getCurrentToolExecutionNonce: () => this.runtimeState.toolExecutionNonce,
      setCurrentToolExecutionNonce: (next) => {
        this.runtimeState.setToolExecutionNonce(next);
      },
      getActiveToolCancellationHandler: () => this.runtimeState.activeToolCancellationHandler,
      setActiveToolCancellationHandler: (handler) => {
        this.runtimeState.setActiveToolCancellationHandler(handler);
      },
      getEventSender: () => this.outputPort.getSender(),
      currentModelSupportsTools: () => this.currentModelSupportsTools(),
      getCurrentModelId: () => this.getCurrentModelId(),
      getSubAgentConfig: (name) => this.getSubAgentConfig(name),
      getContextSummary: () => this.getContextSummary(),
      getCurrentChatSession: () => this.currentChatSession,
      saveChatSession: () => this.saveChatSession(),
      getAgentMcpServerNames: () => {
        const config = this.getLatestAgentConfig();
        return config?.mcp_servers?.map(s => s.name) ?? [];
      },
    });
  }

  private getToolExecutor(): AgentChatToolExecutor {
    if (!this.toolExecutor) {
      this.toolExecutor = this.createToolExecutor();
    }
    return this.toolExecutor;
  }

  private createStreamingService(): AgentChatStreamingService {
    return new AgentChatStreamingService({
      getAgentName: () => this.getAgentName(),
      getChatId: () => this.chatId,
      getChatSessionId: () => this.chatSessionId,
      getCurrentModelId: () => this.getCurrentModelId(),
      getCurrentModelConfig: (modelId) => this.getCurrentModelConfig(modelId),
      getModelCapabilities: (modelId) => this.getModelCapabilities(modelId),
      getCurrentAvailableTools: () => this.getCurrentAvailableTools(),
      getCombinedSystemPromptForCurrentTurn: () => this.getCombinedSystemPromptForCurrentTurn(),
      getContextHistory: () => this.getContextHistory(),
      currentModelSupportsTools: () => this.currentModelSupportsTools(),
      getSessionFromAuthManager: () => this.getSessionFromAuthManager(),
      emitStreamingChunk: (chunk) => this.emitStreamingChunk(chunk),
      setChatStatus: (status) => this.setChatStatus(status as ChatStatus),
    });
  }

  private getStreamingService(): AgentChatStreamingService {
    if (!this.streamingService) {
      this.streamingService = this.createStreamingService();
    }
    return this.streamingService;
  }

  private createTurnRunner(): AgentChatTurnRunner {
    return new AgentChatTurnRunner({
      getAgentName: () => this.getAgentName(),
      getChatId: () => this.chatId,
      getChatSessionId: () => this.chatSessionId,
      getCurrentChatSession: () => this.currentChatSession,
      getChatHistory: () => this.getChatHistory(),
      getDisplayMessages: () => this.getDisplayMessages(),
      getSessionFromAuthManager: () => this.getSessionFromAuthManager(),
      runConversationAttempt: (token, callbacks) => this.startChat(token, callbacks),
      checkAndCompress: (options) => this.CheckAndCompress(options),
      setChatStatus: (status) => this.setChatStatus(status),
      callWithToolsStreaming: (token) => this.callWithToolsStreaming(token),
      addMessageToSession: (message) => this.AddMessageToSession(message),
      batchValidateAndRequestApproval: (toolCalls) => this.batchValidateAndRequestApproval(toolCalls),
      executeToolCall: (toolCall, approved) => this.executeToolCall(toolCall, approved),
      postProcessToolResult: (toolCall, toolResult) => this.postProcessToolResult(toolCall, toolResult),
      assertExecutionActive: (token, executionNonce, stage) => this.assertExecutionActive(token, executionNonce, stage),
      createMcpImageHash: (data, mimeType) => this.createMcpImageHash(data, mimeType),
      hasInjectedMcpImageHash: (hash) => this.hasInjectedMcpImageHash(hash),
      emitStreamingChunk: (chunk) => this.emitStreamingChunk(chunk),
      saveChatSession: () => this.saveChatSession(),
      calculateAndNotifyContext: () => this.calculateAndNotifyContext(),
      extractFactsFromConversation: () => this.extractFactsFromConversation(),
      cleanupIncompleteToolCalls: () => this.cleanupIncompleteToolCalls(),
      resetMessagesToSave: () => this.runtimeState.setMessagesToSave([]),
      clearOutput: () => this.outputPort.clear(),
      getCurrentModelId: () => this.getCurrentModelId(),
      onUsageReceived: (usage) => {
        try {
          const buddyManager = BuddyManager.getInstance();
          if (usage.totalTokens > 0) {
            buddyManager.addXP(usage.totalTokens, 'chat');
          }
        } catch (error) {
          logger.warn('[Buddy] Failed to add XP: ' + (error instanceof Error ? error.message : String(error)));
        }
      },
      anchorTokenEstimate: (apiPromptTokens) => {
        this.contextService?.anchorTokenEstimate(apiPromptTokens);
      },
    });
  }

  private getTurnRunner(): AgentChatTurnRunner {
    if (!this.turnRunner) {
      this.turnRunner = this.createTurnRunner();
    }
    return this.turnRunner;
  }
  private getAnalyticsDayKey(timestamp: number): string {
    const chinaOffsetMs = 8 * 60 * 60 * 1000;
    const utcPlus8 = new Date(timestamp + chinaOffsetMs);
    const year = utcPlus8.getUTCFullYear();
    const month = String(utcPlus8.getUTCMonth() + 1).padStart(2, '0');
    const day = String(utcPlus8.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private getMessageTimestampMs(message: Message): number {
    if (typeof message.timestamp === 'number' && Number.isFinite(message.timestamp)) {
      return message.timestamp;
    }

    if (typeof message.timestamp === 'string') {
      const parsed = Date.parse(message.timestamp);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }

    return Date.now();
  }

  private shouldTrackChatSessionActivatedForUserMessage(message: Message): boolean {
    if (!this.currentChatSession || message.role !== 'user') {
      return false;
    }

    const targetDayKey = this.getAnalyticsDayKey(this.getMessageTimestampMs(message));
    return !this.currentChatSession.chat_history.some((historyMessage) => {
      if (historyMessage.role !== 'user') {
        return false;
      }

      return this.getAnalyticsDayKey(this.getMessageTimestampMs(historyMessage)) === targetDayKey;
    });
  }

  private getChatSessionEntryTypeForUserMessage(message: Message): 'new' | 'continued' {
    return this.currentChatSession && this.currentChatSession.chat_history.length === 0 && message.role === 'user'
      ? 'new'
      : 'continued';
  }

  private trackChatSessionActivated(_message: Message, _sessionEntryType: 'new' | 'continued'): void {
    // Analytics removed.
  }

  /**
   * 🔥 Modified: Set chat status and sync to frontend - sends for all ChatSessions
   */
  private setChatStatus(status: ChatStatus): void {
    this.runtimeState.setChatStatus(status);
    this.statusChangeListeners.forEach((listener) => {
      try {
        listener(status);
      } catch (error) {
        logger.warn('[AgentChat] Status change listener failed', 'setChatStatus', {
          chatId: this.chatId,
          chatSessionId: this.chatSessionId,
          status,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
    this.outputPort.emitStatus(status);
  }

  /**
   * 🔥 New: Get current chat status
   */
  public getChatStatus(): ChatStatus {
    return this.runtimeState.chatStatus;
  }

  /**
   * Force chat status to idle after cancellation timeout.
   * Used by AgentChatManager when the cancellation token has been fired but the
   * conversation loop hasn't unwound within the timeout window (e.g. a long-running
   * MCP tool that hasn't checked the token yet). Without this, the internal status
   * stays at received_response and blocks subsequent user messages.
   */
  public forceIdleStatus(): void {
    const previous = this.runtimeState.chatStatus;
    if (previous === ChatStatus.IDLE) return;
    logger.info('[AgentChat] Forcing status to idle after cancellation timeout', 'forceIdleStatus', {
      chatId: this.chatId,
      chatSessionId: this.chatSessionId,
      previousStatus: previous,
    });
    this.setChatStatus(ChatStatus.IDLE);
  }

  /**
   * 🔥 New: Get chat status info (including chatId)
   */
  public getChatStatusInfo(): { chatId: string; chatStatus: ChatStatus; agentName: string } {
    return {
      chatId: this.chatId,
      chatStatus: this.runtimeState.chatStatus,
      agentName: this.getAgentName()
    };
  }

  public getPendingInteractiveRequest(): InteractiveRequest | null {
    return this.runtimeState.pendingInteractiveRequest;
  }

  public getInteractionHistory(): InteractionHistoryEntry[] {
    return this.currentChatSession?.interaction_history || [];
  }

  /**
   * 🔥 Modified: Unified event sending method - removed filtering, all events are sent
   */
  private safeEmitEvent(eventName: string, data: any): void {
    this.outputPort.emitEvent(eventName, data);
  }

  /**
   * 🔄 New: Dynamically get the latest Agent configuration
   * Retrieves from ProfileCacheManager using currentUserAlias and chatId
   */
  private getLatestAgentConfig(): AgentConfig | null {
    if (!this.currentUserAlias || !this.chatId) {
      return null;
    }

    const chatConfig = profileCacheManager.getChatConfig(this.currentUserAlias, this.chatId);
    if (!chatConfig || !chatConfig.agent) {
      return null;
    }

    return {
      role: chatConfig.agent.role,
      emoji: chatConfig.agent.emoji,
      name: chatConfig.agent.name,
      model: chatConfig.agent.model,
      reasoningEffort: chatConfig.agent.reasoningEffort,
      mcp_servers: chatConfig.agent.mcp_servers || [],
      system_prompt: chatConfig.agent.system_prompt || '',
      context_enhancement: chatConfig.agent.context_enhancement
    };
  }

  /**
   * Initialize Agent instance
   */
  async initialize(): Promise<void> {
    try {
      // 🔄 Optimization: No longer need to load model list into local cache
      // this.loadSupportedModels()  // ❌ Removed
      void this.calculateAndNotifyContext().catch((error) => {
        logger.error(`[AgentChat] Failed to initialize agent ${this.getAgentName()}: ${error instanceof Error ? error.message : String(error)}`);
      });
    } catch (error) {
      logger.error(`[AgentChat] Failed to initialize agent ${this.getAgentName()}: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Get Chat ID
   */
  getChatId(): string {
    return this.chatId;
  }


  /**
   * Get User Alias
   */
  getUserAlias(): string {
    return this.currentUserAlias;
  }

  /**
   * 🔄 New: Dynamically get current model ID.
   * Public so external callers (e.g. SubAgentManager when resolving the parent
   * model for an "inherit" sub-agent) can read the live value without using
   * structural-typing escapes.
   */
  public getCurrentModelId(): string {
    const config = this.getLatestAgentConfig();
    return config?.model || getDefaultModel();
  }

  /**
   * Get the token counter, recreating it if the active model's tokenizer
   * has changed since the counter was last built. This ensures encoder
   * alignment survives mid-session model switches in cached AgentChat instances.
   */
  private getTokenCounter(): TokenCounter {
    const modelId = this.getCurrentModelId();
    const caps = getModelCapabilities(modelId);
    const requiredEncoding = caps?.tokenizer || 'o200k_base';
    if (requiredEncoding !== this.tokenCounterEncoding) {
      this.tokenCounterEncoding = requiredEncoding;
      this.tokenCounter = createTokenCounter({
        defaultEncoding: requiredEncoding,
        enableCache: true,
        cacheSize: 10000,
      });
    }
    return this.tokenCounter;
  }

  /**
   * 🔥 Refactor: Dynamically get currently available tools (no longer cached)
   * Fetches the latest connected tools from MCP manager and ProfileCacheManager on each call
   */
  private async getCurrentAvailableTools(): Promise<any[]> {
    return this.getPromptService().getCurrentAvailableTools();
  }

  /**
   * 🔄 New: Get the latest Custom System Prompt (from AgentConfig)
   * @returns {Message[]} system-prompt array (single-element array)
   */
  private getLatestCustomSystemPrompt(): Message[] {
    return this.getPromptService().getLatestCustomSystemPrompt();
  }

  /**
   * 🔄 New: Get Global System Prompt (from globalSystemPrompt.ts)
   * @returns {Message[]} system-prompt array (single-element array)
   */
  private getGlobalSystemPrompt(): Message[] {
    return this.getPromptService().getGlobalSystemPrompt();
  }

  /**
   * 🔄 New: Get Agent Specific System Prompt (including agent identity, workspace info, and skills instructions)
   * @returns {Message[]} agent-specific system-prompt array (single-element array)
   */
  private getAgentSpecificSystemPrompt(): Message[] {
    return this.getPromptService().getAgentSpecificSystemPrompt();
  }

  /**
   * 🆕 Build sub-agent management System Prompt
   *
   * When a parent Agent has sub-agents configured, inject sub-agent descriptions
   * and usage guidelines into getAgentSpecificSystemPrompt().
   *
   * @param subAgentNames List of sub-agent names referenced by the Agent (from ChatAgent.sub_agents)
   * @returns Sub-agent management prompt text, or empty string
   */
  private buildSubAgentsSystemPrompt(subAgentNames: string[]): string {
    return this.getPromptService().buildSubAgentsSystemPrompt(subAgentNames);
  }

  /**
   * 🔄 New: Merge Custom, Agent-Specific, and Global System Prompt
   * @returns {Message[]} Merged system-prompt array (single-element array)
   */
  private getCombinedSystemPromptForContext(): Message[] {
    return this.getPromptService().getCombinedSystemPromptForContext();
  }

  private async refreshSkillSnapshotIfNeeded(): Promise<void> {
    await this.getPromptService().refreshSkillSnapshotIfNeeded();
  }

  private async getCombinedSystemPromptForCurrentTurn(): Promise<Message[]> {
    // Drain background sub-agent results into context_history before the LLM call
    await this.drainBackgroundSubAgentResults();
    return this.getPromptService().getCombinedSystemPromptForCurrentTurn();
  }

  /**
   * Drain completed background sub-agent results and notifications, injecting them as
   * user messages into context_history so the LLM sees them in the conversation flow.
   * Aligned with Claude Code's approach: notifications as conversation messages, not system prompt.
   */
  private async drainBackgroundSubAgentResults(): Promise<void> {
    try {
      const sessionId = this.chatSessionId;
      if (!sessionId) return;

      const { SubAgentManager } = await import('../subAgent/subAgentManager');
      const manager = SubAgentManager.getInstance();

      const results = manager.drainResults(sessionId);
      const notifications = manager.drainNotifications(sessionId);

      if (results.length === 0 && notifications.length === 0) return;

      const parts: string[] = [];

      if (results.length > 0) {
        const formatted = results.map((r: any) =>
          `### ${r.subAgentName} (${r.success ? '✅ Completed' : '❌ Failed'})\n` +
          `Duration: ${(r.durationMs / 1000).toFixed(1)}s | Turns: ${r.turnCount}\n\n` +
          (r.success ? r.result : `Error: ${r.error}${r.partialResult ? `\n\nPartial result:\n${r.partialResult}` : ''}`)
        ).join('\n\n---\n\n');
        parts.push(formatted);
      }

      if (notifications.length > 0) {
        const formatted = notifications.map((n: any) =>
          `[${n.type.toUpperCase()}] ${n.subAgentName}: ${n.message}`
        ).join('\n');
        parts.push(`## Sub-Agent Notifications\n\n${formatted}`);
      }

      // Inject as a user message into context_history (visible in conversation flow)
      const contextHistory = this.getContextHistory();
      const notificationMessage = MessageHelper.createTextMessage(
        `<task-notification>\n${parts.join('\n\n')}\n</task-notification>`,
        'user',
      );
      contextHistory.push(notificationMessage);
    } catch {
      // Non-critical — don't break the chat if drain fails
    }
  }



  // ====== ChatSession Management Methods ======

  /**
   * 🔄 Fix: Save ChatSession to persistent storage
   * Uses the instance's own chatId, no longer needs parameter passing
   */
  async saveChatSession(): Promise<{success: boolean; error?: string}> {
    return this.getSessionService().saveChatSession();
  }

  getSystemMessages(): Message[] {
    return this.getCombinedSystemPromptForContext()
  }

  getCurrentChatSession(): ChatSessionFile | null {
    return this.currentChatSession
  }

  /**
   * Replace file path references in current ChatSession's chat_history and context_history.
   * Used when a file is moved to Knowledge Base - updates all path references so Agent can consume the correct file.
   * @param oldPath - Original file path
   * @param newPath - New file path after move
   * @returns { success: boolean, replacedCount: number, error?: string }
   */
  async replaceFilePathInSession(oldPath: string, newPath: string): Promise<{ success: boolean; replacedCount: number; error?: string }> {
    return this.getSessionService().replaceFilePathInSession(oldPath, newPath);
  }

  async editUserMessage(
    messageId: string,
    updatedMessage: Message,
    token?: CancellationToken,
    callbacks?: StartChatCallbacks,
  ): Promise<Message[]> {
    return this.getSessionService().editUserMessage(messageId, updatedMessage, token, callbacks);
  }

  canEditUserMessage(messageId: string): { canEdit: boolean; error?: string } {
    const validation = this.validateUserMessageEditable(messageId);
    return {
      canEdit: validation.canEdit,
      error: validation.error,
    };
  }

  private validateUserMessageEditable(messageId: string): UserMessageEditValidationResult {
    return this.getSessionService().validateUserMessageEditable(messageId);
  }

  private createChatSession(params: CreateChatSessionParams = {}): void {
    this.getSessionService().createChatSession(params)
    this.schedulerJobId = params.schedulerJobId
  }


  /**
   * 🔥 New: Get ChatSessionId (public method)
   */
  getChatSessionId(): string {
    return this.chatSessionId;
  }

  /**
   * Set the scheduler job ID on the current session (for scheduled task sessions)
   */
  setSchedulerJobId(jobId: string): void {
    this.schedulerJobId = jobId;
  }

  /**
   * Skip session persistence (for eval/headless sessions that don't need disk storage).
   */
  setSkipPersistence(skip: boolean): void {
    this.skipPersistence = skip;
  }

  setInteractionPolicy(policy: AgentChatInteractionPolicy): void {
    this.interactionPolicy = policy;
  }

  getBlockedInteractionDetails(): BlockedInteractionDetails | null {
    return this.blockedInteractionDetails;
  }

  setSchedulerExecutionState(
    status: 'running' | 'completed' | 'failed',
    options?: {
      startedAt?: string;
      completedAt?: string;
      error?: string;
    }
  ): void {
    this.schedulerExecutionMetadata.schedulerExecutionStatus = status;

    if (options?.startedAt !== undefined) {
      this.schedulerExecutionMetadata.schedulerStartedAt = options.startedAt;
    }

    if (options?.completedAt !== undefined) {
      this.schedulerExecutionMetadata.schedulerCompletedAt = options.completedAt;
    }

    if (options?.error !== undefined) {
      this.schedulerExecutionMetadata.schedulerError = options.error;
    }
  }

  hydrateSchedulerMetadata(
    metadata: Pick<ChatSession, 'schedulerJobId' | 'schedulerExecutionStatus' | 'schedulerStartedAt' | 'schedulerCompletedAt' | 'schedulerError'>
  ): void {
    this.schedulerJobId = metadata.schedulerJobId;
    this.schedulerExecutionMetadata = {
      ...(metadata.schedulerExecutionStatus ? { schedulerExecutionStatus: metadata.schedulerExecutionStatus } : {}),
      ...(metadata.schedulerStartedAt ? { schedulerStartedAt: metadata.schedulerStartedAt } : {}),
      ...(metadata.schedulerCompletedAt ? { schedulerCompletedAt: metadata.schedulerCompletedAt } : {}),
      ...(metadata.schedulerError ? { schedulerError: metadata.schedulerError } : {}),
    }
  }

  private getSchedulerMetadata(): {
    schedulerJobId?: string;
    schedulerExecutionStatus?: 'running' | 'completed' | 'failed';
    schedulerStartedAt?: string;
    schedulerCompletedAt?: string;
    schedulerError?: string;
  } {
    return {
      ...(this.schedulerJobId ? { schedulerJobId: this.schedulerJobId } : {}),
      ...(this.schedulerExecutionMetadata.schedulerExecutionStatus
        ? { schedulerExecutionStatus: this.schedulerExecutionMetadata.schedulerExecutionStatus }
        : {}),
      ...(this.schedulerExecutionMetadata.schedulerStartedAt
        ? { schedulerStartedAt: this.schedulerExecutionMetadata.schedulerStartedAt }
        : {}),
      ...(this.schedulerExecutionMetadata.schedulerCompletedAt
        ? { schedulerCompletedAt: this.schedulerExecutionMetadata.schedulerCompletedAt }
        : {}),
      ...(this.schedulerExecutionMetadata.schedulerError
        ? { schedulerError: this.schedulerExecutionMetadata.schedulerError }
        : {}),
    }
  }

  /**
   * 🔥 Fix: Update the in-memory ChatSession title (used by rename to keep cache in sync)
   */
  updateSessionTitle(newTitle: string): boolean {
    if (!this.currentChatSession) {
      return false;
    }

    this.currentChatSession.title = newTitle;
    return true;
  }


  initializeEmptyChatSession(): void {
    this.currentChatSession = null
    this.firstUserMessage = null  // 🔥 Clear cached first message
    this.schedulerJobId = undefined
    this.skipPersistence = false
    this.schedulerExecutionMetadata = {}
  }

  addMessageToChatHistory(message: Message): void {
    // 🔥 Note: currentChatSession creation has been moved to AddMessageToSession
    if (!this.currentChatSession) {
      throw new Error('currentChatSession must be initialized before calling addMessageToChatHistory. Use AddMessageToSession instead.');
    }

    this.currentChatSession.chat_history.push(message)
    this.currentChatSession.last_updated = new Date().toISOString()
  }

  /**
   * 🔄 New: Generate title for ChatSession
   */
  private async generateChatSessionTitle(userMessage: Message): Promise<void> {
    await this.getSessionService().generateChatSessionTitle(userMessage)
  }

  /**
   * 🔄 New: Generate fallback title
   */
  private generateFallbackTitle(userMessageText: string): string {
    return this.getSessionService().generateFallbackTitle(userMessageText)
  }

  /**
   * 🔥 New: AddMessageToSession - unified message add and save method
   * Handles adding messages to Chat History and Context History, and implements atomic save strategy
   */
  private async AddMessageToSession(message: Message): Promise<void> {
    await this.getSessionService().addMessageToSession(message)
  }

  private createMcpImageHash(data: string, mimeType: string): string {
    return createHash('md5').update(mimeType).update(':').update(data).digest('hex');
  }

  private hasInjectedMcpImageHash(hash: string): boolean {
    const messages = this.currentChatSession?.chat_history ?? [];

    for (const message of messages) {
      if (message.role !== 'user') {
        continue;
      }

      for (const image of MessageHelper.getImages(message)) {
        const metadata = image.metadata as typeof image.metadata & {
          autoInjectedToolResultHash?: string;
        };

        if (metadata.autoInjectedToolResultHash === hash) {
          return true;
        }
      }
    }

    return false;
  }


  /**
   * 🔥 New: Standalone Fact Extraction method
   * Extracted from saveChatSession, executed independently after conversation turn completes
   */
  private async extractFactsFromConversation(): Promise<void> {
    // Memory/Context Enhancement removed — no-op
  }

  async addMessageToContext(message: Message): Promise<void> {
    await this.getContextService().addMessageToContext(message)
  }

  private async enhanceUserMessageContext(message: Message): Promise<Message> {
    return message;
  }


  getContextHistory(): Message[] {
    return this.currentChatSession?.context_history || []
  }

  getChatHistory(): Message[] {
    return this.currentChatSession?.chat_history || []
  }

  /**
   * 🔥 New: Get current CancellationToken
   * Returns the token passed to startChat / streamMessage, used for ToolExecutionContext
   */
  getCancellationToken(): CancellationToken | undefined {
    return this.runtimeState.currentCancellationToken;
  }

  private assertExecutionActive(token: CancellationToken | undefined, executionNonce: number, stage: string): void {
    this.getToolExecutor().assertExecutionActive(token, executionNonce, stage);
  }

  public invalidateActiveExecution(): void {
    this.getToolExecutor().invalidateActiveExecution();
  }

  public async cancelActiveToolExecution(): Promise<void> {
    await this.getToolExecutor().cancelActiveToolExecution();
  }

  private registerActiveToolCancellationHandler(handler: () => Promise<void> | void): { dispose(): void } {
    return this.getToolExecutor().registerActiveToolCancellationHandler(handler);
  }

  /**
   * 🔥 New: Get the sub-agent config bound to the current Agent by name
   * Steps: 1) Confirm reference from ChatAgent.sub_agents (name list); 2) Return config from ProfileV2.sub_agents (global registry)
   */
  getSubAgentConfig(name: string): import('../userDataADO/types/profile').SubAgentConfig | undefined {
    if (!this.currentUserAlias || !this.chatId) return undefined;
    // Get current ChatConfig -> ChatAgent
    const chatConfig = profileCacheManager.getChatConfig(this.currentUserAlias, this.chatId);
    const agentSubNames = chatConfig?.agent?.sub_agents;
    if (!agentSubNames || !agentSubNames.includes(name)) {
      return undefined; // This Agent does not reference this sub-agent
    }
    // Look up from file system cache (sync, cache is pre-warmed at startup)
    const fileManager = SubAgentFileManager.getInstance();
    return fileManager.getCachedConfig(name) as import('../userDataADO/types/profile').SubAgentConfig | undefined;
  }

  /**
   * 🔥 New: Generate context summary for the current session
   * Used for SubAgent context_access = 'parent_summary' mode
   * Concatenates content from the most recent N messages
   */
  getContextSummary(): string {
    const contextHistory = this.getContextHistory();
    if (!contextHistory || contextHistory.length === 0) {
      return '';
    }
    // Take the last 20 messages for summary (to avoid being too large)
    const recent = contextHistory.slice(-20);
    const parts: string[] = [];
    for (const msg of recent) {
      const role = msg.role || 'unknown';
      const text = MessageHelper.getText(msg).trim();
      if (text) {
        parts.push(`[${role}]: ${text.substring(0, 500)}`);
      }
    }
    return parts.join('\n');
  }

  // ====== Main Chat Processing Methods ======

  /**
   * 🔥 New: Check and perform compression
   * First check if compression is needed, if so set compression state and execute compression
   */
  private async CheckAndCompress(options?: { emitStatus?: boolean; force?: boolean }): Promise<{ applied: boolean }> {
    return await this.getContextService().checkAndCompress(options);
  }

  /**
   * 🔄 Retry the last failed conversation (without adding new messages, using existing context history)
   *
   * When an API call fails (e.g., 502 error), the user message has already been added to context history,
   * this method allows retrying the LLM call directly without resending the user message
   *
   * @param token - optional cancellation token
   * @param callbacks - optional callback functions
   * @returns display message array
   */
  async retryChat(
    token?: CancellationToken,
    callbacks?: StartChatCallbacks
  ): Promise<Message[]> {
    return this.getTurnRunner().runRetry({ token, callbacks });
  }

  /**
   * �🔄 Modified: streamMessage supports CancellationToken
   *
   * @param userMessage - user message
   * @param token - optional cancellation token
   * @param callbacks - optional callback functions
   * @param options - optional settings
   * @param options.emitUserMessage - whether to emit user message chunk to frontend (for remote channel scenarios where frontend doesn't pre-add the user message)
   * @returns display message array
   */
  async streamMessage(
    userMessage: UserMessage,
    token?: CancellationToken,
    callbacks?: StartChatCallbacks,
    options?: { emitUserMessage?: boolean; isRemoteSession?: boolean; interactionPolicy?: AgentChatInteractionPolicy }
  ): Promise<Message[]> {
    // Check if this is an External Agent agent — route through WS instead of LLM
    const chatConfig = profileCacheManager.getChatConfig(this.currentUserAlias, this.chatId);
    if (chatConfig?.agent?.source === 'EXTERNAL' && isFeatureEnabled('openkosmosFeatureExternalAgent')) {
      return this.handleExternalAgentMessage(userMessage);
    }

    // Set remote session flag for the duration of this turn
    this.isRemoteSession = options?.isRemoteSession || false;
    this.interactionPolicy = options?.interactionPolicy || (this.isRemoteSession ? 'plain-text-only' : 'allow-ui');
    this.blockedInteractionDetails = null;

    // Record turn start time for Chat TTFT measurement
    const streamingService = this.getStreamingService();
    streamingService.turnStartTime = Date.now();
    streamingService.ttftReportedForTurn = false;

    try {
      return await this.getTurnRunner().runStreamMessage({
        userMessage,
        token,
        callbacks,
        emitUserMessage: !!options?.emitUserMessage,
      });
    } finally {
      this.isRemoteSession = false;
      this.interactionPolicy = 'allow-ui';
      this.blockedInteractionDetails = null;
    }
  }

  /**
   * Handle messages for External Agent agents — delegates to externalAgentChatHandler.
   * Fire-and-forget: sends user message via WS, bot replies arrive asynchronously via push handler.
   */
  private async handleExternalAgentMessage(
    userMessage: Message,
  ): Promise<Message[]> {
    const result = await externalAgentMessageHandler(
      {
        chatId: this.chatId,
        chatSessionId: this.currentChatSession?.chatSession_id || '',
        addMessageToSession: (msg) => this.AddMessageToSession(msg),
        emitStreamingChunk: (chunk) => this.emitStreamingChunk(chunk),
        emitStatus: (s) => this.outputPort.emitStatus(s === 'sending' ? ChatStatus.SENDING_RESPONSE : ChatStatus.IDLE),
      },
      userMessage,
    );

    // Only start push timeout if message was sent successfully (empty result = success).
    // If send failed, handler already returned error message and set IDLE — no timeout needed.
    if (result.length === 0) {
      this.pushReceiver.startOrResetPushTimeout();
    }

    return result;
  }

  /**
   * Handle a push chunk from external agent (bot-initiated streaming).
   */
  handlePushChunk(text: string, msgId?: string): void {
    this.pushReceiver.handlePushChunk(text, msgId);
  }

  /**
   * Finalize a push stream from external agent.
   */
  async handlePushComplete(skipPersistence?: boolean): Promise<void> {
    await this.pushReceiver.handlePushComplete(skipPersistence);
  }

  /**
   * Add a message to the session (in-memory + disk atomically).
   * Used by ExternalAgentService to persist push messages with the full
   * accumulated text while keeping AgentChat's in-memory state in sync.
   */
  async addMessageToSession(msg: Message): Promise<void> {
    await this.AddMessageToSession(msg);
  }

  /**
   * Cancel an in-progress push stream.
   */
  cancelPush(): void {
    this.pushReceiver.cancelPush();
  }

  /**
   * 🔄 Modified: startChat supports CancellationToken
   */
  private async startChat(
    token?: CancellationToken,
    callbacks: StartChatCallbacks = {}
  ): Promise<void> {
    // 🔌 Plugin hook: fire SessionStart on the first turn of this chat
    if (!this.sessionStartHookFired) {
      this.sessionStartHookFired = true;
      try {
        const chatConfig = profileCacheManager.getChatConfig(this.currentUserAlias, this.chatId);
        const workspacePath = chatConfig?.agent?.workspace;
        const hookResult = await hookRegistry.execute('SessionStart', {
          userAlias: this.currentUserAlias,
          chatId: this.chatId,
          chatSessionId: this.chatSessionId,
          agentName: this.getAgentName(),
          workspacePath: typeof workspacePath === 'string' && workspacePath.trim() ? workspacePath : undefined,
        });

        // Inject additionalContext from hooks into the prompt service
        if (hookResult.additionalContexts.length > 0) {
          this.getPromptService().setHookAdditionalContexts(hookResult.additionalContexts);
          createLogger().info(
            `[AgentChat] SessionStart hooks injected ${hookResult.additionalContexts.length} additional context(s) ` +
            `(total ${hookResult.additionalContexts.reduce((s, c) => s + c.length, 0)} chars)`,
          );
        }
      } catch (e) {
        // Non-fatal: hook failure must never block conversation
        createLogger().error(`[AgentChat] SessionStart hook error: ${e}`);
      }
    }

    this.runtimeState.bindCancellationToken(token);
    const executionNonce = this.runtimeState.bumpToolExecutionNonce();

    try {
      await this.getTurnRunner().run({ token, callbacks, executionNonce });
    } catch (error) {
      // Guard: if a newer turn has already started (nonce bumped again), this is a
      // stale cancellation unwind — skip cleanup to avoid corrupting the new turn's state.
      if (executionNonce === this.runtimeState.toolExecutionNonce) {
        await this.getTurnRunner().handleFailure(error);
      } else {
        createLogger().info(
          '[AgentChat] Skipping stale cancellation cleanup — newer turn active',
          'startChat',
          { executionNonce, activeNonce: this.runtimeState.toolExecutionNonce }
        );
      }
      throw error;
    } finally {
      // Only clear the token if this turn still owns it (no newer turn has started).
      // A stale cancelled turn reaching finally must not wipe the new turn's token.
      if (executionNonce === this.runtimeState.toolExecutionNonce) {
        this.runtimeState.clearCancellationToken();
      }
    }
  }

  // ====== Core API Call Methods ======

  /**
   * 🔄 Modified: callWithToolsStreaming supports CancellationToken
   */
  async callWithToolsStreaming(token?: CancellationToken): Promise<StreamingApiResponse> {
    return this.getStreamingService().callWithToolsStreaming(token);
  }

  /**
   * Unified interactive request helpers.
   */
  private buildInteractionId(prefix: string): string {
    return this.getInteractionService().buildInteractionId(prefix);
  }

  private buildInteractionHistoryEntry(
    request: InteractiveRequest,
    response: InteractiveResponse,
  ): InteractionHistoryEntry {
    return this.getInteractionService().buildInteractionHistoryEntry(request, response);
  }

  private buildInteractionSummary(request: InteractiveRequest, response: InteractiveResponse): string {
    return this.getInteractionService().buildInteractionSummary(request, response);
  }

  private async finalizeInteractiveRequest(
    request: InteractiveRequest,
    response: InteractiveResponse,
  ): Promise<InteractiveResponse> {
    return this.getInteractionService().finalizeInteractiveRequest(request, response);
  }

  private async requestUserInteraction(
    request: InteractiveRequest,
    fallbackResponse: InteractiveResponse,
  ): Promise<InteractiveResponse> {
    return this.getInteractionService().requestUserInteraction(request, fallbackResponse);
  }

  private async requestApprovalInteraction(
    requests: ApprovalRequestItem[],
  ): Promise<Map<string, boolean>> {
    return this.getInteractionService().requestApprovalInteraction(requests);
  }

  private async batchValidateAndRequestApproval(
    toolCalls: Array<{id: string; function: {name: string; arguments: string}}>
  ): Promise<Map<string, boolean>> {
    return this.getInteractionService().batchValidateAndRequestApproval(toolCalls);
  }

  /**
   * 🔥 New: Post-processing method after tool execution completes
   * Post-processes results of specific tools, such as collecting user input
   */
  private async postProcessToolResult(toolCall: any, toolResult: any): Promise<any> {
    return this.getToolPostProcessor().postProcessToolResult(toolCall, toolResult);
  }

  private async postProcessForRequestInteractiveInputTool(toolResult: any): Promise<any> {
    return this.getToolPostProcessor().postProcessForRequestInteractiveInputTool(toolResult);
  }

  /**
   * Request structured form input from the user through the unified interaction pipeline.
   */
  private async requestUserInfoInput(
    request: {
      fields: Array<{
        key: string;
        label: string;
        type: string;
        control: string;
        varName: string;
        required: boolean;
        defaultValue?: string;
      }>;
      header: { title: string };
      body: { description: string };
    }
  ): Promise<Record<string, any> | null> {
    return this.getInteractionService().requestUserInfoInput(request);
  }

  private async requestUserChoice(
    title: string,
    description: string,
    options: ChoiceInteractionOption[],
    mode: 'single' | 'multi',
  ): Promise<string[] | null> {
    return this.getInteractionService().requestUserChoice(title, description, options, mode);
  }

  async executeToolCall(toolCall: any, approved?: boolean): Promise<any> {
    return this.getToolExecutor().executeToolCall(toolCall, approved);
  }

  /**
   * 🔄 New: Enable/disable compression
   */
  setCompressionEnabled(enabled: boolean): void {
    // Compression is always enabled, maintaining interface compatibility
  }

  /**
   * 🔄 New: Check if compression is enabled
   */
  isCompressionEnabled(): boolean {
    return !!this.fullModeCompressor;
  }

  /**
   * 🔄 New: Get compression system status
   */
  getCompressionStatus(): {
    enabled: boolean;
    fullModeCompressionReady: boolean;
    currentModel: string;
  } {
    return {
      enabled: true,
      fullModeCompressionReady: !!this.fullModeCompressor,
      currentModel: this.getCurrentModelId()
    };
  }


  // ====== Model Management ======

  // 🔄 Optimization: removed loadSupportedModels(), directly using ghcModels methods

  /**
   * 🔄 New: Get current model config from ghcModels.ts
   */
  private getCurrentModelConfig(modelId: string) {
    const model = getModelById(modelId);
    const reasoningEffort = this.getLatestAgentConfig()?.reasoningEffort?.toLowerCase();
    if (!model) {
      return {
        maxTokens: 4000,
        supportsTemperature: true,
        supportsTools: false,
        supportsImages: false,
        reasoningEffort
      };
    }

    return {
      maxTokens: model.capabilities.limits?.max_output_tokens || 4000,
      supportsTemperature: !model.capabilities.family.includes('o3') && !model.capabilities.family.includes('o4'),
      supportsTools: model.capabilities.supports.tool_calls || false,
      supportsImages: model.capabilities.supports.vision || false,
      reasoningEffort
    };
  }

  getModelCapabilities(modelId: string): GhcModelCapabilities {
    const capabilities = getModelCapabilities(modelId);
    if (!capabilities) {
      throw new GhcApiError(`Model capabilities not found for: ${modelId}`, 404);
    }
    return capabilities;
  }

  currentModelSupportsTools(): boolean {
    const capabilities = this.getModelCapabilities(this.getCurrentModelId());
    return capabilities.supportsTools;
  }

  currentModelSupportsImages(): boolean {
    const capabilities = this.getModelCapabilities(this.getCurrentModelId());
    return capabilities.supportsImages;
  }


  async getSessionFromAuthManager(): Promise<any | null> {
    try {
      const currentAuth = mainAuthManager.getCurrentAuth();

      if (currentAuth && currentAuth.ghcAuth) {
        return {
          type: 'ghc',
          accessToken: currentAuth.ghcAuth.copilotTokens?.token || '',
          user: currentAuth.ghcAuth.user
        };
      } else {
        return null;
      }
    } catch (error) {
      logger.error(`[AgentChat] Failed to get session from AuthManager: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }


  // ====== Context Management ======

  addContextChangeListener(listener: (stats: ContextStats) => void): void {
    this.contextChangeListeners.push(listener)
    if (this.latestContextStats) {
      try {
        listener(this.latestContextStats)
      } catch (error) {
        logger.error(`[AgentChat] Error sending cached stats to new listener: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  addStatusChangeListener(listener: (status: ChatStatus) => void): () => void {
    this.statusChangeListeners.push(listener)
    return () => {
      this.statusChangeListeners = this.statusChangeListeners.filter((item) => item !== listener)
    }
  }

  removeContextChangeListener(listener: (stats: ContextStats) => void): void {
    const index = this.contextChangeListeners.indexOf(listener)
    if (index > -1) {
      this.contextChangeListeners.splice(index, 1)
    }
  }

  /**
   * 🔄 New: Shared method for calculating three-component token consumption
   * contextHistory + systemPrompt + tools
   */
  private async calculateThreeComponentTokens(contextHistory?: Message[]): Promise<{
    contextHistoryTokens: number;
    systemPromptTokens: number;
    toolsTokens: number;
    totalTokens: number;
  }> {
    return this.getContextService().calculateThreeComponentTokens(contextHistory);
  }

  /**
   * 🔄 Rewritten: calculate and notify Context changes - using real token calculation
   * 🔥 Changed to public to allow external trigger for recalculation (e.g., after mainWindow is ready)
   * 🔥 New: also update contextTokenUsage private variable
   */
  async calculateAndNotifyContext(): Promise<void> {
    await this.getContextService().calculateAndNotifyContext();
  }

  private notifyContextChange(stats: ContextStats): void {
    this.getContextService().notifyContextChange(stats)
  }

  /**
   * 🔥 New: Get the latest ContextTokenUsage
   * Called by AgentChatManager, used to notify frontend cache
   */
  getContextTokenUsage(): ContextTokenUsage | null {
    return this.contextTokenUsage;
  }

  getDisplayMessages(): Message[] {
    const chatHistory = this.getChatHistory()
    const customSystemPrompt = this.getLatestCustomSystemPrompt()
    return [...customSystemPrompt, ...chatHistory]
  }

  // ====== Agent Management ======

  async getAgentInfo() {
    // 🔥 Fully relies on dynamically fetching the latest config
    const latestConfig = this.getLatestAgentConfig();

    if (!latestConfig) {
      throw new Error(`Cannot get agent info: no config available for userAlias=${this.currentUserAlias}, chatId=${this.chatId}`);
    }

    const tools = await this.getCurrentAvailableTools();
    return {
      role: latestConfig.role,
      emoji: latestConfig.emoji,
      name: latestConfig.name,
      model: latestConfig.model,
      mcpServers: latestConfig.mcp_servers,
      systemPrompt: latestConfig.system_prompt,
      currentModel: this.getCurrentModelId(),
      toolsCount: tools.length,
      chatHistoryLength: this.getChatHistory().length,
    }
  }


  // 🔥 New: set event sender
  setEventSender(sender: Electron.WebContents | null): void {
    this.outputPort.setSender(sender);
  }

  hasEventSender(): boolean {
    return this.outputPort.hasSender();
  }

  /**
   * 🔥 Modified: method for sending streaming chunks - removed filtering, all chunks are sent
   */
  private emitStreamingChunk(chunk: any): void {
    this.outputPort.emitStreamingChunk(chunk);
  }

  destroy(): void {
    this.pushReceiver.destroy();
    this.setChatStatus(ChatStatus.IDLE)  // 🔥 New: reset chat state to idle
    this.contextChangeListeners = []
    this.statusChangeListeners = []
    this.latestContextStats = null
    // Preserve currentChatSession content to prevent async save references from being cleared after destroy
    this.outputPort.clear()
  }

  /**
   * 🔥 New: Clean up incomplete tool calls
   * When cancellation occurs, handle unexecuted tool_calls in the last assistant message
   *
   * Processing logic:
   * 1. Find executed tools (with corresponding tool message)
   * 2. Find unexecuted tools (without corresponding tool message)
   * 3. Only keep executed tool_calls, remove unexecuted ones
   * 4. If no tools were executed and content is empty, delete the entire assistant message
   * 5. Also clean up orphaned tool messages (without corresponding tool_call)
   */
  private async cleanupIncompleteToolCalls(): Promise<void> {
    await this.getToolExecutor().cleanupIncompleteToolCalls();
  }

  /**
   * 🔥 New: Exit New Chat Session state
   * When the first user message is saved successfully, notify AgentChatManager to remove the mapping from newChatSessionIdForChatId
   */
  private exitNewChatSessionState(): void {
    try {
      agentChatManager.exitNewChatSessionFor(this.chatId, this.chatSessionId);

      logger.info('[AgentChat] ✅ Exited New Chat Session state', 'exitNewChatSessionState', {
        chatId: this.chatId,
        chatSessionId: this.chatSessionId,
        agentName: this.getAgentName()
      });
    } catch (error) {
      logger.error('[AgentChat] Failed to exit New Chat Session state', 'exitNewChatSessionState', {
        chatId: this.chatId,
        chatSessionId: this.chatSessionId,
        agentName: this.getAgentName(),
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

}
