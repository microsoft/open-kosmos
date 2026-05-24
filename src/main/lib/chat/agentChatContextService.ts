import { Message, MessageHelper } from '@shared/types/chatTypes';
import type { AgentConfig } from './agentChat';
import { ChatStatus, type ContextStats, type ContextTokenUsage } from './agentChatTypes';
import { createLogger } from '../unifiedLogger';
import type { ChatSessionFile } from '../userDataADO/chatSessionFileOps';
import type { GhcModelCapabilities } from '@shared/types/ghcChatTypes';
import type { TokenCounter } from '../token';
import type { FullModeCompressor } from '../compression/fullModeCompressor';
import { getEndpointForModel } from '../llm/ghcModelApi';
import {
  checkCompressionNeeds,
  compressContextHistoryWithFullMode,
  formatMessagesForApi,
} from './agentChatUtilities';
import {
  extractDiscoveredToolNames,
  buildDiscoveredToolsTag,
  filterToolsForRequest,
  shouldEnableToolSearch,
  formatDeferredToolsIndex,
} from './toolSearchFilter';
import { isFeatureEnabled } from '../featureFlags';

const logger = createLogger();

// VS Code Copilot alignment constants
const BASE_TOKENS_PER_MESSAGE = 3;
const BASE_TOKENS_PER_COMPLETION = 3;

// Model correction factors (Pillar 3) — preset values used before the first API call
const MODEL_CORRECTION_FACTORS: Record<string, number> = {
  'claude': 1.4,    // Based on empirical data: 708k→1005k
  'gemini': 1.1,    // Conservative estimate
  // GPT models need no correction (tokenizer aligns directly)
};

function stripImageDataUrls(messages: any[]): any[] {
  return messages.map((msg) => {
    if (!Array.isArray(msg.content)) return msg;
    return {
      ...msg,
      content: msg.content.map((part: any) => {
        if (part.type === 'image_url' && part.image_url?.url?.startsWith('data:')) {
          return { type: 'image_url', image_url: { url: '', detail: part.image_url.detail } };
        }
        if (part.type === 'input_image' && part.image_url?.startsWith('data:')) {
          return { type: 'input_image', image_url: '', detail: part.detail };
        }
        return part;
      }),
    };
  });
}

function countImageTokensInMessages(tokenCounter: TokenCounter, messages: Message[]): number {
  let total = 0;
  for (const msg of messages) {
    for (const part of msg.content) {
      if (part.type === 'image') {
        total += tokenCounter.countImageTokens({
          detail: part.image_url.detail,
          width: part.metadata?.width,
          height: part.metadata?.height,
        }).tokens;
      }
    }
  }
  return total;
}

export interface AgentChatContextServiceDeps {
  getCurrentChatSession(): ChatSessionFile | null;
  getCurrentUserAlias(): string;
  getAgentName(): string;
  getLatestAgentConfig(): AgentConfig | null;
  getCurrentModelId(): string;
  getModelCapabilities(modelId: string): GhcModelCapabilities;
  getContextHistory(): Message[];
  getChatHistory(): Message[];
  getCombinedSystemPromptForCurrentTurn(): Promise<Message[]>;
  getCurrentAvailableTools(): Promise<any[]>;
  getTokenCounter(): TokenCounter;
  getFullModeCompressor(): FullModeCompressor;
  setChatStatus(status: ChatStatus): void;
  setContextHistory(messages: Message[]): void;
  setLastUpdated(timestamp: string): void;
  getContextChangeListeners(): Array<(stats: ContextStats) => void>;
  getLatestContextStats(): ContextStats | null;
  setLatestContextStats(stats: ContextStats | null): void;
  setContextTokenUsage(usage: ContextTokenUsage | null): void;
}

export class AgentChatContextService {
  // Pillar 2: API Usage anchor state
  private lastLocalEstimate: number | null = null;
  private correctionRatio: number = 1.0;

  constructor(private readonly deps: AgentChatContextServiceDeps) {}

  /**
   * Pillar 2: Anchor local estimate using prompt_tokens returned by the API
   */
  anchorTokenEstimate(apiPromptTokens: number): void {
    if (this.lastLocalEstimate && this.lastLocalEstimate > 0) {
      this.correctionRatio = apiPromptTokens / this.lastLocalEstimate;
      logger.info('[AgentChatContextService] Token estimate anchored', 'anchorTokenEstimate', {
        apiPromptTokens,
        localEstimate: this.lastLocalEstimate,
        correctionRatio: this.correctionRatio.toFixed(4),
      });
    }
  }

  /**
   * Pillar 3: Get the model's preset correction factor
   */
  private getModelCorrectionFactor(modelId: string): number {
    const modelLower = modelId.toLowerCase();
    for (const [prefix, factor] of Object.entries(MODEL_CORRECTION_FACTORS)) {
      if (modelLower.includes(prefix)) return factor;
    }
    return 1.0;
  }

  async addMessageToContext(message: Message): Promise<void> {
    const currentChatSession = this.deps.getCurrentChatSession();
    if (!currentChatSession) {
      return;
    }

    currentChatSession.context_history.push(message);
    this.deps.setLastUpdated(new Date().toISOString());

    this.calculateAndNotifyContext();
  }

  async checkAndCompress(options?: { emitStatus?: boolean; force?: boolean }): Promise<{ applied: boolean }> {
    const emitStatus = options?.emitStatus !== false;
    const force = options?.force === true;
    try {
      const currentContextHistory = this.deps.getContextHistory();
      const currentModelId = this.deps.getCurrentModelId();
      const modelCapabilities = this.deps.getModelCapabilities(currentModelId);
      const contextWindowSize = modelCapabilities.maxContextLength;

      // Reserve output token space (capped at 20,000)
      const outputTokenReserve = Math.min(modelCapabilities.maxOutputLength || 4096, 20_000);

      const needsCompression = force
        ? true
        : await checkCompressionNeeds(
            currentContextHistory,
            contextWindowSize,
            this.deps.getAgentName(),
            async () => this.calculateThreeComponentTokens(),
            outputTokenReserve,
          );

      if (needsCompression) {
        if (emitStatus) {
          this.deps.setChatStatus(ChatStatus.COMPRESSING_CONTEXT);
        }

        const compressionResult = await compressContextHistoryWithFullMode(
          currentContextHistory,
          this.deps.getFullModeCompressor(),
          this.deps.getAgentName(),
        );

        if (compressionResult.success && compressionResult.compressedMessages) {
          // Preserve discovered tool names across compaction: extract from
          // pre-compression messages and embed into the summary message so
          // extractDiscoveredToolNames() can recover them later.
          const preCompactDiscovered = extractDiscoveredToolNames(currentContextHistory);
          if (preCompactDiscovered.size > 0) {
            const tag = buildDiscoveredToolsTag(preCompactDiscovered);
            if (tag) {
              // Find the summary message (id starts with 'summary_') and append the tag
              for (const msg of compressionResult.compressedMessages) {
                if (msg.id.startsWith('summary_')) {
                  const currentText = MessageHelper.getText(msg);
                  MessageHelper.setTextContent(msg, currentText + tag);
                  break;
                }
              }
            }
          }

          this.deps.setContextHistory(compressionResult.compressedMessages);
          this.deps.setLastUpdated(new Date().toISOString());
          if (emitStatus) {
            this.deps.setChatStatus(ChatStatus.COMPRESSED_CONTEXT);
          }
          return { applied: true };
        }
      }
      return { applied: false };
    } catch (error) {
      logger.error('[AgentChat] Error in CheckAndCompress', 'CheckAndCompress', {
        error: error instanceof Error ? error.message : String(error),
        agentName: this.deps.getAgentName(),
      });
      return { applied: false };
    }
  }

  async calculateThreeComponentTokens(contextHistory?: Message[]): Promise<{
    contextHistoryTokens: number;
    systemPromptTokens: number;
    toolsTokens: number;
    totalTokens: number;
  }> {
    const currentContextHistory = contextHistory || this.deps.getContextHistory();
    const tokenCounter = this.deps.getTokenCounter();
    const systemMessages = await this.deps.getCombinedSystemPromptForCurrentTurn();
    const currentModelId = this.deps.getCurrentModelId();
    const modelCapabilities = this.deps.getModelCapabilities(currentModelId);
    const endpoint = getEndpointForModel(currentModelId);
    const formattedMessages = await formatMessagesForApi(
      systemMessages,
      currentContextHistory,
      !!modelCapabilities.supportsTools,
      endpoint,
    );

    const strippedMessages = stripImageDataUrls(formattedMessages);
    const textPayloadTokens = tokenCounter.countTextTokens(JSON.stringify(strippedMessages));

    // Align with VS Code Copilot: add message overhead constants
    const messageCount = formattedMessages.length;
    const messageOverhead = messageCount * BASE_TOKENS_PER_MESSAGE + BASE_TOKENS_PER_COMPLETION;

    const imageTokens = countImageTokensInMessages(tokenCounter, [
      ...systemMessages,
      ...currentContextHistory,
    ]);
    const rawFormattedPayloadTokens = textPayloadTokens + messageOverhead + imageTokens;

    let systemPromptTokens = 0;
    if (systemMessages.length > 0) {
      systemPromptTokens = tokenCounter.countMessagesTokens(systemMessages);
    }

    const contextHistoryTokens = Math.max(0, rawFormattedPayloadTokens - systemPromptTokens);

    let toolsTokens = 0;
    const currentTools = await this.deps.getCurrentAvailableTools();
    if (currentTools.length > 0) {
      // When tool search is active, only inline tools (not deferred) are sent as tool schemas.
      // Deferred tools are sent as a text index instead. Calculate tokens accordingly.
      const toolSearchEnabled = isFeatureEnabled('openkosmosFeatureToolSearch')
        && shouldEnableToolSearch(currentTools, modelCapabilities.maxContextLength);
      if (toolSearchEnabled) {
        const { filteredTools, deferredTools } = filterToolsForRequest(
          currentTools, currentContextHistory, { enabled: true });
        // Token cost = inline tool schemas + deferred index text
        if (filteredTools.length > 0) {
          toolsTokens = tokenCounter.countToolsTokens(
            filteredTools.map(t => ({ ...t, description: t.description ?? '' }))).totalTokens;
        }
        if (deferredTools.length > 0) {
          const indexText = formatDeferredToolsIndex(deferredTools);
          toolsTokens += tokenCounter.countTextTokens(indexText);
        }
      } else {
        const toolsResult = tokenCounter.countToolsTokens(currentTools);
        toolsTokens = toolsResult.totalTokens;
      }
    }

    // Raw local estimate (used for anchoring)
    const rawTotal = rawFormattedPayloadTokens + toolsTokens;
    this.lastLocalEstimate = rawTotal;

    // Apply correction: prefer API-anchored ratio; fall back to model preset factor
    const correctionFactor = this.correctionRatio !== 1.0
      ? this.correctionRatio
      : this.getModelCorrectionFactor(currentModelId);
    const totalTokens = Math.ceil(rawTotal * correctionFactor);

    return {
      contextHistoryTokens: Math.ceil(contextHistoryTokens * correctionFactor),
      systemPromptTokens,
      toolsTokens,
      totalTokens,
    };
  }

  async calculateAndNotifyContext(): Promise<void> {
    const contextHistory = this.deps.getContextHistory();

    try {
      const tokens = await this.calculateThreeComponentTokens();
      const chatHistory = this.deps.getChatHistory();
      const systemMessages = await this.deps.getCombinedSystemPromptForCurrentTurn();
      const contextStats: ContextStats = {
        totalMessages: systemMessages.length + chatHistory.length,
        contextMessages: contextHistory.length,
        tokenCount: tokens.totalTokens,
        compressionRatio: 1.0,
      };

      this.deps.setContextTokenUsage({
        tokenCount: contextStats.tokenCount,
        totalMessages: contextStats.totalMessages,
        contextMessages: contextStats.contextMessages,
        compressionRatio: contextStats.compressionRatio,
      });

      this.notifyContextChange(contextStats);
    } catch (error) {
      logger.error('[AgentChat] Failed to calculate context tokens', 'AgentChat.calculateAndNotifyContext', error);
      const estimatedContextHistoryTokens = contextHistory.length * 50;
      const systemMessages = await this.deps.getCombinedSystemPromptForCurrentTurn();
      const estimatedSystemPromptTokens = systemMessages.length * 50;
      const estimatedToolsTokens = (await this.deps.getCurrentAvailableTools()).length * 100;
      const estimatedTotal = estimatedContextHistoryTokens + estimatedSystemPromptTokens + estimatedToolsTokens;
      const chatHistory = this.deps.getChatHistory();
      const fallbackStats: ContextStats = {
        totalMessages: systemMessages.length + chatHistory.length,
        contextMessages: contextHistory.length,
        tokenCount: estimatedTotal,
        compressionRatio: 1.0,
      };

      this.deps.setContextTokenUsage({
        tokenCount: fallbackStats.tokenCount,
        totalMessages: fallbackStats.totalMessages,
        contextMessages: fallbackStats.contextMessages,
        compressionRatio: fallbackStats.compressionRatio,
      });

      this.notifyContextChange(fallbackStats);
    }
  }

  notifyContextChange(stats: ContextStats): void {
    this.deps.setLatestContextStats({ ...stats });

    const listeners = this.deps.getContextChangeListeners() || [];
    if (listeners.length === 0) {
      return;
    }

    listeners.forEach((listener, index) => {
      try {
        listener(stats);
      } catch (error) {
        logger.error(`[AgentChat] Context change listener ${index} error: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  }
}