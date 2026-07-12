// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Message } from '@shared/types/chatTypes';

// ── module mocks ──────────────────────────────────────────────────────────────

vi.mock('../../unifiedLogger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
  createConsoleLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock('../../featureFlags', () => ({
  featureFlagManager: {
    isEnabled: vi.fn(() => false),
  },
  isFeatureEnabled: vi.fn(() => false),
}));

vi.mock('../../llm/ghcModelApi', () => ({
  getEndpointForModel: vi.fn(() => 'openai'),
}));

vi.mock('../agentChatUtilities', () => ({
  checkCompressionNeeds: vi.fn(() => Promise.resolve(false)),
  compressContextHistoryWithFullMode: vi.fn(() =>
    Promise.resolve({ success: false, compressedMessages: null })
  ),
  formatMessagesForApi: vi.fn(() => Promise.resolve([])),
}));

vi.mock('../toolSearchFilter', () => ({
  extractDiscoveredToolNames: vi.fn(() => new Set()),
  buildDiscoveredToolsTag: vi.fn(() => ''),
  filterToolsForRequest: vi.fn(() => ({ filteredTools: [], deferredTools: [] })),
  shouldEnableToolSearch: vi.fn(() => false),
  formatDeferredToolsIndex: vi.fn(() => ''),
}));

// ── imports ───────────────────────────────────────────────────────────────────

import { AgentChatContextService } from '../agentChatContextService';
import { MessageHelper } from '@shared/types/chatTypes';
import { featureFlagManager, isFeatureEnabled } from '../../featureFlags';
import {
  checkCompressionNeeds,
  compressContextHistoryWithFullMode,
  formatMessagesForApi,
} from '../agentChatUtilities';
import {
  extractDiscoveredToolNames,
  buildDiscoveredToolsTag,
  shouldEnableToolSearch,
  filterToolsForRequest,
  formatDeferredToolsIndex,
} from '../toolSearchFilter';
import { ChatStatus } from '../agentChatTypes';

// ── helpers ───────────────────────────────────────────────────────────────────

function makeMsg(text: string, role: 'user' | 'assistant' = 'user', id = 'msg1'): Message {
  return MessageHelper.createTextMessage(text, role, id);
}

interface DepOverrides {
  getChatHistory?: () => Message[];
  getCombinedSystemPromptForCurrentTurn?: () => Promise<Message[]>;
  getCurrentAvailableTools?: () => Promise<any[]>;
  getTokenCounter?: () => any;
  getContextHistory?: () => Message[];
  getContextChangeListeners?: () => Array<(s: any) => void>;
  getLatestAgentConfig?: () => any;
  getCurrentUserAlias?: () => string;
  getCurrentChatSession?: () => any;
  getModelCapabilities?: (id: string) => any;
  getCurrentModelId?: () => string;
  onBeforeCompaction?: (trigger: 'auto' | 'manual', options: { signal: AbortSignal }) => Promise<void> | void;
  onAfterCompaction?: (trigger: 'auto' | 'manual', options: { signal: AbortSignal }) => Promise<void> | void;
}

function makeDeps(overrides: DepOverrides = {}) {
  const chatSession: any = {
    chat_history: [],
    context_history: [],
    chatSession_id: 'session1',
    last_updated: '',
  };

  const tokenCounter = {
    countTextTokens: vi.fn(() => 10),
    countMessagesTokens: vi.fn(() => 5),
    countImageTokens: vi.fn(() => ({ tokens: 0 })),
    countToolsTokens: vi.fn(() => ({ totalTokens: 0 })),
  };

  const deps = {
    getCurrentChatSession: () => chatSession,
    getCurrentUserAlias: () => 'testuser',
    getAgentName: () => 'TestAgent',
    getLatestAgentConfig: () => null as any,
    getCurrentModelId: () => 'gpt-4',
    getModelCapabilities: (_id: string) => ({
      maxContextLength: 128000,
      maxOutputLength: 4096,
      supportsTools: true,
    }),
    getContextHistory: () => chatSession.context_history as Message[],
    getChatHistory: () => chatSession.chat_history as Message[],
    getCombinedSystemPromptForCurrentTurn: vi.fn(() => Promise.resolve([] as Message[])),
    getCurrentAvailableTools: vi.fn(() => Promise.resolve([] as any[])),
    getTokenCounter: () => tokenCounter,
    getFullModeCompressor: vi.fn() as any,
    setChatStatus: vi.fn(),
    setContextHistory: vi.fn((msgs: Message[]) => { chatSession.context_history = msgs; }),
    setLastUpdated: vi.fn(),
    getContextChangeListeners: () => [] as Array<(s: any) => void>,
    getLatestContextStats: () => null,
    setLatestContextStats: vi.fn(),
    setContextTokenUsage: vi.fn(),
    ...overrides,
  };

  return { deps, chatSession, tokenCounter };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('AgentChatContextService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── anchorTokenEstimate ────────────────────────────────────────────────────

  describe('anchorTokenEstimate', () => {
    it('updates correctionRatio when lastLocalEstimate is positive', async () => {
      const { deps } = makeDeps();
      const svc = new AgentChatContextService(deps);
      // Trigger calculateThreeComponentTokens to set lastLocalEstimate
      vi.mocked(formatMessagesForApi).mockResolvedValue([]);
      await svc.calculateThreeComponentTokens();
      svc.anchorTokenEstimate(200);
      // No error thrown; ratio is set internally
    });

    it('does nothing when lastLocalEstimate is null', () => {
      const { deps } = makeDeps();
      const svc = new AgentChatContextService(deps);
      expect(() => svc.anchorTokenEstimate(100)).not.toThrow();
    });
  });

  // ── extractFactsFromConversation ───────────────────────────────────────────

  describe('extractFactsFromConversation', () => {
    it('resolves without throwing (memory feature removed, no-op)', async () => {
      const { deps } = makeDeps();
      const svc = new AgentChatContextService(deps);
      await expect(svc.extractFactsFromConversation()).resolves.toBeUndefined();
    });
  });

  // ── addMessageToContext ────────────────────────────────────────────────────

  describe('addMessageToContext', () => {
    it('returns early when no chat session', async () => {
      const { deps } = makeDeps({ getCurrentChatSession: () => null });
      const svc = new AgentChatContextService(deps);
      await svc.addMessageToContext(makeMsg('hi'));
      // No push, no error
    });

    it('pushes user message', async () => {
      const { deps, chatSession } = makeDeps();
      const svc = new AgentChatContextService(deps);
      svc.calculateAndNotifyContext = vi.fn().mockResolvedValue(undefined);
      await svc.addMessageToContext(makeMsg('hello', 'user'));
      expect(chatSession.context_history).toHaveLength(1);
    });

    it('pushes assistant message', async () => {
      const { deps, chatSession } = makeDeps();
      const svc = new AgentChatContextService(deps);
      svc.calculateAndNotifyContext = vi.fn().mockResolvedValue(undefined);
      await svc.addMessageToContext(makeMsg('reply', 'assistant'));
      expect(chatSession.context_history).toHaveLength(1);
    });
  });

  // ── checkAndCompress ──────────────────────────────────────────────────────

  describe('checkAndCompress', () => {
    it('returns { applied: false } when compression not needed', async () => {
      vi.mocked(checkCompressionNeeds).mockResolvedValue(false);
      const { deps } = makeDeps();
      vi.mocked(formatMessagesForApi).mockResolvedValue([]);
      const svc = new AgentChatContextService(deps);
      const result = await svc.checkAndCompress();
      expect(result).toEqual({ applied: false });
    });

    it('returns { applied: false } when compressContextHistoryWithFullMode fails', async () => {
      vi.mocked(checkCompressionNeeds).mockResolvedValue(true);
      vi.mocked(compressContextHistoryWithFullMode).mockResolvedValue({
        success: false,
        compressedMessages: null,
      } as any);
      const { deps } = makeDeps();
      vi.mocked(formatMessagesForApi).mockResolvedValue([]);
      const svc = new AgentChatContextService(deps);
      const result = await svc.checkAndCompress({ emitStatus: true });
      expect(result).toEqual({ applied: false });
    });

    it('returns { applied: true } on successful compression', async () => {
      vi.mocked(checkCompressionNeeds).mockResolvedValue(true);
      const compressedMsg = makeMsg('summary', 'user', 'summary_1');
      vi.mocked(compressContextHistoryWithFullMode).mockResolvedValue({
        success: true,
        compressedMessages: [compressedMsg],
      } as any);
      vi.mocked(extractDiscoveredToolNames).mockReturnValue(new Set());
      const { deps } = makeDeps();
      vi.mocked(formatMessagesForApi).mockResolvedValue([]);
      const svc = new AgentChatContextService(deps);
      const result = await svc.checkAndCompress();
      expect(result).toEqual({ applied: true });
    });

    it('preserves discovered tool names in summary message', async () => {
      vi.mocked(checkCompressionNeeds).mockResolvedValue(true);
      const summaryMsg = MessageHelper.createTextMessage('summary text', 'user', 'summary_abc');
      vi.mocked(compressContextHistoryWithFullMode).mockResolvedValue({
        success: true,
        compressedMessages: [summaryMsg],
      } as any);
      vi.mocked(extractDiscoveredToolNames).mockReturnValue(new Set(['tool1']));
      vi.mocked(buildDiscoveredToolsTag).mockReturnValue('<discovered>tool1</discovered>');

      const { deps } = makeDeps();
      vi.mocked(formatMessagesForApi).mockResolvedValue([]);
      const svc = new AgentChatContextService(deps);
      await svc.checkAndCompress();
      expect(buildDiscoveredToolsTag).toHaveBeenCalled();
    });

    it('force=true bypasses checkCompressionNeeds', async () => {
      vi.mocked(compressContextHistoryWithFullMode).mockResolvedValue({
        success: true,
        compressedMessages: [makeMsg('s', 'user', 'summary_x')],
      } as any);
      vi.mocked(extractDiscoveredToolNames).mockReturnValue(new Set());
      const { deps } = makeDeps();
      vi.mocked(formatMessagesForApi).mockResolvedValue([]);
      const svc = new AgentChatContextService(deps);
      const result = await svc.checkAndCompress({ force: true });
      expect(result).toEqual({ applied: true });
      expect(checkCompressionNeeds).not.toHaveBeenCalled();
    });

    it('emitStatus=false skips setChatStatus calls', async () => {
      vi.mocked(checkCompressionNeeds).mockResolvedValue(true);
      vi.mocked(compressContextHistoryWithFullMode).mockResolvedValue({
        success: true,
        compressedMessages: [makeMsg('s', 'user', 'summary_x')],
      } as any);
      vi.mocked(extractDiscoveredToolNames).mockReturnValue(new Set());
      const { deps } = makeDeps();
      vi.mocked(formatMessagesForApi).mockResolvedValue([]);
      const svc = new AgentChatContextService(deps);
      await svc.checkAndCompress({ emitStatus: false });
      expect(deps.setChatStatus).not.toHaveBeenCalled();
    });

    it('catches thrown errors and returns { applied: false }', async () => {
      vi.mocked(checkCompressionNeeds).mockRejectedValue(new Error('boom'));
      const { deps } = makeDeps();
      vi.mocked(formatMessagesForApi).mockResolvedValue([]);
      const svc = new AgentChatContextService(deps);
      const result = await svc.checkAndCompress();
      expect(result).toEqual({ applied: false });
    });

    it('fires onBeforeCompaction and onAfterCompaction with the auto trigger when compaction applies', async () => {
      vi.mocked(checkCompressionNeeds).mockResolvedValue(true);
      vi.mocked(compressContextHistoryWithFullMode).mockResolvedValue({
        success: true,
        compressedMessages: [makeMsg('s', 'user', 'summary_x')],
      } as any);
      vi.mocked(extractDiscoveredToolNames).mockReturnValue(new Set());
      const onBeforeCompaction = vi.fn();
      const onAfterCompaction = vi.fn();
      const { deps } = makeDeps({ onBeforeCompaction, onAfterCompaction });
      vi.mocked(formatMessagesForApi).mockResolvedValue([]);
      const svc = new AgentChatContextService(deps);
      await svc.checkAndCompress();
      expect(onBeforeCompaction).toHaveBeenCalledWith('auto', expect.objectContaining({ signal: expect.any(Object) }));
      expect(onAfterCompaction).toHaveBeenCalledWith('auto', expect.objectContaining({ signal: expect.any(Object) }));
    });

    it('uses the manual trigger when compaction is forced', async () => {
      vi.mocked(compressContextHistoryWithFullMode).mockResolvedValue({
        success: true,
        compressedMessages: [makeMsg('s', 'user', 'summary_x')],
      } as any);
      vi.mocked(extractDiscoveredToolNames).mockReturnValue(new Set());
      const onBeforeCompaction = vi.fn();
      const onAfterCompaction = vi.fn();
      const { deps } = makeDeps({ onBeforeCompaction, onAfterCompaction });
      vi.mocked(formatMessagesForApi).mockResolvedValue([]);
      const svc = new AgentChatContextService(deps);
      await svc.checkAndCompress({ force: true });
      expect(onBeforeCompaction).toHaveBeenCalledWith('manual', expect.objectContaining({ signal: expect.any(Object) }));
      expect(onAfterCompaction).toHaveBeenCalledWith('manual', expect.objectContaining({ signal: expect.any(Object) }));
    });

    it('does not fire onAfterCompaction when compression fails', async () => {
      vi.mocked(checkCompressionNeeds).mockResolvedValue(true);
      vi.mocked(compressContextHistoryWithFullMode).mockResolvedValue({ success: false } as any);
      const onBeforeCompaction = vi.fn();
      const onAfterCompaction = vi.fn();
      const { deps } = makeDeps({ onBeforeCompaction, onAfterCompaction });
      vi.mocked(formatMessagesForApi).mockResolvedValue([]);
      const svc = new AgentChatContextService(deps);
      await svc.checkAndCompress();
      expect(onBeforeCompaction).toHaveBeenCalledWith('auto', expect.objectContaining({ signal: expect.any(Object) }));
      expect(onAfterCompaction).not.toHaveBeenCalled();
    });

    it('does not fire the compaction callbacks when no compression is needed', async () => {
      vi.mocked(checkCompressionNeeds).mockResolvedValue(false);
      const onBeforeCompaction = vi.fn();
      const onAfterCompaction = vi.fn();
      const { deps } = makeDeps({ onBeforeCompaction, onAfterCompaction });
      vi.mocked(formatMessagesForApi).mockResolvedValue([]);
      const svc = new AgentChatContextService(deps);
      await svc.checkAndCompress();
      expect(onBeforeCompaction).not.toHaveBeenCalled();
      expect(onAfterCompaction).not.toHaveBeenCalled();
    });

    it('swallows a throwing compaction callback and still applies compaction', async () => {
      vi.mocked(checkCompressionNeeds).mockResolvedValue(true);
      vi.mocked(compressContextHistoryWithFullMode).mockResolvedValue({
        success: true,
        compressedMessages: [makeMsg('s', 'user', 'summary_x')],
      } as any);
      vi.mocked(extractDiscoveredToolNames).mockReturnValue(new Set());
      const onBeforeCompaction = vi.fn(() => {
        throw new Error('hook exploded');
      });
      const onAfterCompaction = vi.fn(() => Promise.reject(new Error('after exploded')));
      const { deps } = makeDeps({ onBeforeCompaction, onAfterCompaction });
      vi.mocked(formatMessagesForApi).mockResolvedValue([]);
      const svc = new AgentChatContextService(deps);
      const result = await svc.checkAndCompress();
      expect(result).toEqual({ applied: true });
      expect(onBeforeCompaction).toHaveBeenCalled();
      expect(onAfterCompaction).toHaveBeenCalled();
    });

    it('times out a hanging compaction callback and still applies compaction', async () => {
      vi.useFakeTimers();
      try {
        vi.mocked(checkCompressionNeeds).mockResolvedValue(true);
        vi.mocked(compressContextHistoryWithFullMode).mockResolvedValue({
          success: true,
          compressedMessages: [makeMsg('s', 'user', 'summary_x')],
        } as any);
        vi.mocked(extractDiscoveredToolNames).mockReturnValue(new Set());
        let timeoutSignal: AbortSignal | undefined;
        const onBeforeCompaction = vi.fn((_trigger, options: { signal: AbortSignal }) => {
          timeoutSignal = options.signal;
          return new Promise<void>(() => {});
        });
        const onAfterCompaction = vi.fn();
        const { deps } = makeDeps({ onBeforeCompaction, onAfterCompaction });
        vi.mocked(formatMessagesForApi).mockResolvedValue([]);
        const svc = new AgentChatContextService(deps);

        const resultPromise = svc.checkAndCompress();
        await vi.advanceTimersByTimeAsync(5_000);
        await expect(resultPromise).resolves.toEqual({ applied: true });
        expect(onBeforeCompaction).toHaveBeenCalledWith('auto', expect.objectContaining({ signal: expect.any(Object) }));
        expect(timeoutSignal?.aborted).toBe(true);
        expect(onAfterCompaction).toHaveBeenCalledWith('auto', expect.objectContaining({ signal: expect.any(Object) }));
      } finally {
        vi.useRealTimers();
      }
    });

    it('invokes the token-estimate callback passed to checkCompressionNeeds (line 159)', async () => {
      // The 4th arg is `async () => this.calculateThreeComponentTokens()`.
      // Default mock never calls it; this impl invokes it so the callback body runs.
      vi.mocked(checkCompressionNeeds).mockImplementation(
        async (_history, _window, _name, getTokens: any) => {
          await getTokens();
          return false;
        }
      );
      const { deps } = makeDeps();
      vi.mocked(formatMessagesForApi).mockResolvedValue([]);
      const svc = new AgentChatContextService(deps);
      const result = await svc.checkAndCompress();
      expect(result).toEqual({ applied: false });
      expect(checkCompressionNeeds).toHaveBeenCalled();
    });

    it('skips tag append when buildDiscoveredToolsTag returns empty (line 181 false branch)', async () => {
      vi.mocked(checkCompressionNeeds).mockResolvedValue(true);
      const summaryMsg = makeMsg('summary', 'user', 'summary_1');
      vi.mocked(compressContextHistoryWithFullMode).mockResolvedValue({
        success: true,
        compressedMessages: [summaryMsg],
      } as any);
      // size > 0 so we enter the block, but tag is falsy → `if (tag)` is false.
      vi.mocked(extractDiscoveredToolNames).mockReturnValue(new Set(['tool1']));
      vi.mocked(buildDiscoveredToolsTag).mockReturnValue('');
      const { deps } = makeDeps();
      vi.mocked(formatMessagesForApi).mockResolvedValue([]);
      const svc = new AgentChatContextService(deps);
      const result = await svc.checkAndCompress();
      expect(result).toEqual({ applied: true });
    });

    it('skips non-summary messages when appending the discovered-tools tag (line 184 false branch)', async () => {
      vi.mocked(checkCompressionNeeds).mockResolvedValue(true);
      const nonSummary = makeMsg('regular', 'user', 'regular_1');
      const summaryMsg = makeMsg('summary', 'user', 'summary_1');
      vi.mocked(compressContextHistoryWithFullMode).mockResolvedValue({
        success: true,
        compressedMessages: [nonSummary, summaryMsg],
      } as any);
      vi.mocked(extractDiscoveredToolNames).mockReturnValue(new Set(['tool1']));
      vi.mocked(buildDiscoveredToolsTag).mockReturnValue('<discovered>tool1</discovered>');
      const { deps } = makeDeps();
      vi.mocked(formatMessagesForApi).mockResolvedValue([]);
      const svc = new AgentChatContextService(deps);
      const result = await svc.checkAndCompress();
      expect(result).toEqual({ applied: true });
      // The non-summary message must remain untouched.
      expect(MessageHelper.getText(nonSummary)).toBe('regular');
    });

    it('stringifies a non-Error post-compression refresh failure (line 210 String branch)', async () => {
      vi.mocked(compressContextHistoryWithFullMode).mockResolvedValue({
        success: true,
        compressedMessages: [makeMsg('summary', 'user', 'summary_1')],
      } as any);
      vi.mocked(extractDiscoveredToolNames).mockReturnValue(new Set());
      const { deps } = makeDeps();
      // The only formatMessagesForApi call is the post-compression refresh; reject with a non-Error.
      vi.mocked(formatMessagesForApi).mockRejectedValue('refresh string failure');
      const svc = new AgentChatContextService(deps);
      const result = await svc.checkAndCompress({ force: true });
      expect(result).toEqual({ applied: true });
    });

    it('stringifies a non-Error rejection in the outer catch (line 221 String branch)', async () => {
      vi.mocked(checkCompressionNeeds).mockRejectedValue('outer string failure');
      const { deps } = makeDeps();
      vi.mocked(formatMessagesForApi).mockResolvedValue([]);
      const svc = new AgentChatContextService(deps);
      const result = await svc.checkAndCompress();
      expect(result).toEqual({ applied: false });
    });

    it('refreshes lastLocalEstimate after successful compression so anchorTokenEstimate uses post-compression baseline', async () => {
      // Setup: compression succeeds
      vi.mocked(checkCompressionNeeds).mockResolvedValue(true);
      const compressedMsg = makeMsg('summary', 'user', 'summary_1');
      vi.mocked(compressContextHistoryWithFullMode).mockResolvedValue({
        success: true,
        compressedMessages: [compressedMsg],
      } as any);
      vi.mocked(extractDiscoveredToolNames).mockReturnValue(new Set());

      const { deps, tokenCounter } = makeDeps();
      // formatMessagesForApi returns a small payload (post-compression)
      vi.mocked(formatMessagesForApi).mockResolvedValue([{ role: 'user', content: 'summary' }] as any);
      // Token counter returns 50 tokens for the compressed content
      tokenCounter.countMessagesTokens.mockReturnValue(50);

      const svc = new AgentChatContextService(deps);
      await svc.checkAndCompress();

      // Now anchor with a realistic API value close to the post-compression estimate
      // If the fix is correct, correctionRatio = 45/50 = 0.9 (reasonable)
      // If the fix is missing, lastLocalEstimate would be stale (from before compression)
      svc.anchorTokenEstimate(45);

      // Verify: next calculateThreeComponentTokens uses the corrected ratio (~0.9)
      // not a collapsed ratio like 0.03
      const result = await svc.calculateThreeComponentTokens();
      // With countMessagesTokens=50, correction ~0.9, totalTokens should be ~45
      // Without the fix it would be near 0 (50 * 0.0003 or similar)
      expect(result.totalTokens).toBeGreaterThan(30);
      expect(result.totalTokens).toBeLessThan(100);
    });

    it('still returns { applied: true } even if post-compression token refresh throws', async () => {
      // Setup: compression succeeds, use force=true to skip checkCompressionNeeds
      vi.mocked(compressContextHistoryWithFullMode).mockResolvedValue({
        success: true,
        compressedMessages: [makeMsg('summary', 'user', 'summary_1')],
      } as any);
      vi.mocked(extractDiscoveredToolNames).mockReturnValue(new Set());

      const { deps } = makeDeps();
      // The only formatMessagesForApi call will be from the post-compression refresh — make it throw
      vi.mocked(formatMessagesForApi).mockRejectedValue(new Error('token counting failed'));

      const svc = new AgentChatContextService(deps);
      const result = await svc.checkAndCompress({ force: true, emitStatus: true });

      // Compression result must still be reported as applied
      expect(result).toEqual({ applied: true });
      // Status should still have been emitted before the refresh
      expect(deps.setChatStatus).toHaveBeenCalledWith(ChatStatus.COMPRESSED_CONTEXT);
    });
  });

  // ── calculateThreeComponentTokens ─────────────────────────────────────────

  describe('calculateThreeComponentTokens', () => {
    it('returns token breakdown with no tools', async () => {
      vi.mocked(formatMessagesForApi).mockResolvedValue([{ role: 'user', content: 'hi' }] as any);
      const { deps } = makeDeps();
      const svc = new AgentChatContextService(deps);
      const result = await svc.calculateThreeComponentTokens();
      expect(result).toHaveProperty('totalTokens');
      expect(result.totalTokens).toBeGreaterThanOrEqual(0);
    });

    it('uses passed contextHistory override', async () => {
      vi.mocked(formatMessagesForApi).mockResolvedValue([]);
      const { deps } = makeDeps();
      const svc = new AgentChatContextService(deps);
      const result = await svc.calculateThreeComponentTokens([makeMsg('override')]);
      expect(result).toHaveProperty('totalTokens');
    });

    it('accounts for system prompt tokens when present', async () => {
      vi.mocked(formatMessagesForApi).mockResolvedValue([]);
      const systemMsg = makeMsg('system', 'assistant', 'sys1');
      const { deps } = makeDeps({
        getCombinedSystemPromptForCurrentTurn: vi.fn(() => Promise.resolve([systemMsg])),
      });
      const { tokenCounter } = makeDeps();
      deps.getTokenCounter = () => ({
        countTextTokens: vi.fn(() => 50),
        countMessagesTokens: vi.fn(() => 20),
        countImageTokens: vi.fn(() => ({ tokens: 0 })),
        countToolsTokens: vi.fn(() => ({ totalTokens: 0 })),
      });
      const svc = new AgentChatContextService(deps);
      const result = await svc.calculateThreeComponentTokens();
      expect(result.systemPromptTokens).toBe(20);
    });

    it('applies model correction factor for claude models', async () => {
      vi.mocked(formatMessagesForApi).mockResolvedValue([]);
      const { deps } = makeDeps({
        getCurrentModelId: () => 'claude-3-5-sonnet',
      });
      const svc = new AgentChatContextService(deps);
      const result = await svc.calculateThreeComponentTokens();
      // correctionFactor 1.4 for claude — totalTokens >= rawTotal
      expect(result.totalTokens).toBeGreaterThanOrEqual(0);
    });

    it('applies correction ratio from anchor over model preset', async () => {
      vi.mocked(formatMessagesForApi).mockResolvedValue([{ role: 'user', content: 'hi' }] as any);
      const { deps } = makeDeps();
      const svc = new AgentChatContextService(deps);
      // First calculate to set lastLocalEstimate
      await svc.calculateThreeComponentTokens();
      // Anchor with a known API value
      svc.anchorTokenEstimate(500);
      // Calculate again — should use anchored ratio
      const result = await svc.calculateThreeComponentTokens();
      expect(result.totalTokens).toBeGreaterThanOrEqual(0);
    });

    it('includes tools tokens when tools are available and tool search disabled', async () => {
      vi.mocked(formatMessagesForApi).mockResolvedValue([]);
      vi.mocked(isFeatureEnabled).mockReturnValue(false);
      const mockTools = [{ name: 'tool1', description: 'does stuff' }];
      const { deps } = makeDeps({
        getCurrentAvailableTools: vi.fn(() => Promise.resolve(mockTools)),
      });
      const tc = {
        countTextTokens: vi.fn(() => 10),
        countMessagesTokens: vi.fn(() => 5),
        countImageTokens: vi.fn(() => ({ tokens: 0 })),
        countToolsTokens: vi.fn(() => ({ totalTokens: 50 })),
      };
      deps.getTokenCounter = () => tc;
      const svc = new AgentChatContextService(deps);
      const result = await svc.calculateThreeComponentTokens();
      expect(result.toolsTokens).toBe(50);
    });

    it('uses tool search split when feature enabled and tools exceed threshold', async () => {
      vi.mocked(formatMessagesForApi).mockResolvedValue([]);
      vi.mocked(isFeatureEnabled).mockReturnValue(true);
      vi.mocked(shouldEnableToolSearch).mockReturnValue(true);
      vi.mocked(filterToolsForRequest).mockReturnValue({
        filteredTools: [{ name: 'inline', description: 'x' }],
        deferredTools: [{ name: 'deferred', description: 'y' }],
      } as any);
      vi.mocked(formatDeferredToolsIndex).mockReturnValue('deferred index text');
      const mockTools = [{ name: 't1' }, { name: 't2' }];
      const { deps } = makeDeps({
        getCurrentAvailableTools: vi.fn(() => Promise.resolve(mockTools)),
      });
      const tc = {
        countTextTokens: vi.fn(() => 10),
        countMessagesTokens: vi.fn(() => 5),
        countImageTokens: vi.fn(() => ({ tokens: 0 })),
        countToolsTokens: vi.fn(() => ({ totalTokens: 30 })),
      };
      deps.getTokenCounter = () => tc;
      const svc = new AgentChatContextService(deps);
      const result = await svc.calculateThreeComponentTokens();
      expect(result.toolsTokens).toBeGreaterThanOrEqual(0);
    });

    it('handles tool search split with empty filtered and deferred sets (lines 278/282 false branches)', async () => {
      vi.mocked(formatMessagesForApi).mockResolvedValue([]);
      vi.mocked(isFeatureEnabled).mockReturnValue(true);
      vi.mocked(shouldEnableToolSearch).mockReturnValue(true);
      // Both sets empty → `filteredTools.length > 0` and `deferredTools.length > 0` are false.
      vi.mocked(filterToolsForRequest).mockReturnValue({
        filteredTools: [],
        deferredTools: [],
      } as any);
      const mockTools = [{ name: 't1' }, { name: 't2' }];
      const { deps } = makeDeps({
        getCurrentAvailableTools: vi.fn(() => Promise.resolve(mockTools)),
      });
      const svc = new AgentChatContextService(deps);
      const result = await svc.calculateThreeComponentTokens();
      expect(result.toolsTokens).toBe(0);
    });

    it('defaults a filtered tool description to empty string when missing (line 280 ?? branch)', async () => {
      vi.mocked(formatMessagesForApi).mockResolvedValue([]);
      vi.mocked(isFeatureEnabled).mockReturnValue(true);
      vi.mocked(shouldEnableToolSearch).mockReturnValue(true);
      // Filtered tool has NO description → `t.description ?? ''` falls to '' (line 280).
      // Deferred non-empty so line 282 true branch also runs.
      vi.mocked(filterToolsForRequest).mockReturnValue({
        filteredTools: [{ name: 'inline' }],
        deferredTools: [{ name: 'deferred', description: 'y' }],
      } as any);
      vi.mocked(formatDeferredToolsIndex).mockReturnValue('deferred index text');
      const mockTools = [{ name: 't1' }, { name: 't2' }];
      const { deps } = makeDeps({
        getCurrentAvailableTools: vi.fn(() => Promise.resolve(mockTools)),
      });
      const tc = {
        countTextTokens: vi.fn(() => 7),
        countMessagesTokens: vi.fn(() => 5),
        countImageTokens: vi.fn(() => ({ tokens: 0 })),
        countToolsTokens: vi.fn((tools: any[]) => {
          // Assert the description was coerced to '' before counting.
          expect(tools[0].description).toBe('');
          return { totalTokens: 12 };
        }),
      };
      deps.getTokenCounter = () => tc;
      const svc = new AgentChatContextService(deps);
      const result = await svc.calculateThreeComponentTokens();
      expect(result.toolsTokens).toBeGreaterThan(0);
    });
  });

  // ── calculateAndNotifyContext ─────────────────────────────────────────────

  describe('calculateAndNotifyContext', () => {
    it('calls setContextTokenUsage and notifyContextChange on success', async () => {
      vi.mocked(formatMessagesForApi).mockResolvedValue([]);
      const { deps } = makeDeps();
      const svc = new AgentChatContextService(deps);
      await svc.calculateAndNotifyContext();
      expect(deps.setContextTokenUsage).toHaveBeenCalled();
      expect(deps.setLatestContextStats).toHaveBeenCalled();
    });

    it('falls back to estimated tokens when calculateThreeComponentTokens throws', async () => {
      vi.mocked(formatMessagesForApi).mockRejectedValue(new Error('fail'));
      const { deps } = makeDeps();
      const svc = new AgentChatContextService(deps);
      await svc.calculateAndNotifyContext();
      expect(deps.setContextTokenUsage).toHaveBeenCalled();
    });
  });

  // ── notifyContextChange ───────────────────────────────────────────────────

  describe('notifyContextChange', () => {
    it('sets latest context stats', () => {
      const { deps } = makeDeps();
      const svc = new AgentChatContextService(deps);
      const stats = { totalMessages: 2, contextMessages: 1, tokenCount: 100, compressionRatio: 1 };
      svc.notifyContextChange(stats);
      expect(deps.setLatestContextStats).toHaveBeenCalledWith(stats);
    });

    it('calls all listeners with stats', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      const { deps } = makeDeps({
        getContextChangeListeners: () => [listener1, listener2],
      });
      const svc = new AgentChatContextService(deps);
      const stats = { totalMessages: 1, contextMessages: 1, tokenCount: 50, compressionRatio: 1 };
      svc.notifyContextChange(stats);
      expect(listener1).toHaveBeenCalledWith(stats);
      expect(listener2).toHaveBeenCalledWith(stats);
    });

    it('handles listener throwing without propagating', () => {
      const badListener = vi.fn(() => { throw new Error('listener error'); });
      const { deps } = makeDeps({
        getContextChangeListeners: () => [badListener],
      });
      const svc = new AgentChatContextService(deps);
      const stats = { totalMessages: 1, contextMessages: 1, tokenCount: 10, compressionRatio: 1 };
      expect(() => svc.notifyContextChange(stats)).not.toThrow();
    });

    it('stringifies a non-Error thrown by a listener (line 370 String branch)', () => {
      // Listener throws a non-Error → `error instanceof Error ? ... : String(error)`
      // takes the String(error) path inside the catch.
      const badListener = vi.fn(() => { throw 'string listener failure'; });
      const { deps } = makeDeps({
        getContextChangeListeners: () => [badListener],
      });
      const svc = new AgentChatContextService(deps);
      const stats = { totalMessages: 1, contextMessages: 1, tokenCount: 10, compressionRatio: 1 };
      expect(() => svc.notifyContextChange(stats)).not.toThrow();
      expect(badListener).toHaveBeenCalled();
    });

    it('handles no listeners (empty array)', () => {
      const { deps } = makeDeps({ getContextChangeListeners: () => [] });
      const svc = new AgentChatContextService(deps);
      expect(() =>
        svc.notifyContextChange({ totalMessages: 0, contextMessages: 0, tokenCount: 0, compressionRatio: 1 })
      ).not.toThrow();
    });

    it('treats null getContextChangeListeners result as empty (line 361 || [])', () => {
      const { deps } = makeDeps({ getContextChangeListeners: () => null as any });
      const svc = new AgentChatContextService(deps);
      expect(() =>
        svc.notifyContextChange({ totalMessages: 0, contextMessages: 0, tokenCount: 0, compressionRatio: 1 })
      ).not.toThrow();
    });
  });

  // ── stripImageDataUrls branch coverage via calculateThreeComponentTokens ──

  describe('stripImageDataUrls input_image branch (line 46-47)', () => {
    it('strips data: url from input_image parts (anonymous_10 callback)', async () => {
      // formatMessagesForApi returns a message with input_image data URL so
      // stripImageDataUrls covers the input_image branch (line 46).
      vi.mocked(formatMessagesForApi).mockResolvedValue([
        {
          role: 'user',
          content: [
            { type: 'input_image', image_url: 'data:image/png;base64,abc', detail: 'high' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,xyz', detail: 'low' } },
            { type: 'text', text: 'hi' },
          ],
        },
      ] as any);
      const { deps } = makeDeps();
      const svc = new AgentChatContextService(deps);
      // Should not throw; stripImageDataUrls must handle both image variants
      const result = await svc.calculateThreeComponentTokens();
      expect(result.totalTokens).toBeGreaterThanOrEqual(0);
    });

    it('returns non-array content messages unchanged (line 39 false branch)', async () => {
      vi.mocked(formatMessagesForApi).mockResolvedValue([
        { role: 'user', content: 'plain string content' },
      ] as any);
      const { deps } = makeDeps();
      const svc = new AgentChatContextService(deps);
      const result = await svc.calculateThreeComponentTokens();
      expect(result.totalTokens).toBeGreaterThanOrEqual(0);
    });
  });

  // ── anchorTokenEstimate: zero lastLocalEstimate does nothing (line 104) ────

  describe('anchorTokenEstimate edge cases', () => {
    it('does nothing when lastLocalEstimate is zero (line 104 false branch)', async () => {
      const { deps, tokenCounter } = makeDeps();
      tokenCounter.countTextTokens.mockReturnValue(0);
      vi.mocked(formatMessagesForApi).mockResolvedValue([]);
      const svc = new AgentChatContextService(deps);
      await svc.calculateThreeComponentTokens(); // sets lastLocalEstimate to 0
      // Should not change correctionRatio (it would cause divide-by-zero)
      expect(() => svc.anchorTokenEstimate(50)).not.toThrow();
    });
  });
});
