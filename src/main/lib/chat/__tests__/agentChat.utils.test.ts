// Tests for AgentChat utility/state methods that have low coverage:
// getMessageTimestampMs, shouldTrackChatSessionActivatedForUserMessage,
// getChatSessionEntryTypeForUserMessage, updateSessionTitle, forceIdleStatus,
// getChatStatusInfo, setSchedulerExecutionState, hydrateSchedulerMetadata,
// getContextSummary, addContextChangeListener, removeContextChangeListener,
// addStatusChangeListener, isCompressionEnabled, getCompressionStatus,
// createMcpImageHash, hasInjectedMcpImageHash, destroy

import type { Message } from '@shared/types/chatTypes';

vi.mock('../../security/securityValidator', async () => ({
  SecurityValidator: class SecurityValidator {},
  ApprovalRequestItem: class ApprovalRequestItem {},
  BatchValidationResult: class BatchValidationResult {},
  ToolCallValidationResult: class ToolCallValidationResult {},
}));

vi.mock('../../auth/ghcConfig', async () => ({
  GHC_CONFIG: {},
}));

vi.mock('../../utilities/errors', async () => ({
  GhcApiError: class GhcApiError extends Error {},
}));

vi.mock('../../llm/ghcModelsManager', async () => ({
  getModelById: vi.fn(),
  getModelCapabilities: vi.fn(() => ({ supportsTools: true, supportsImages: false, tokenizer: 'o200k_base' })),
  getDefaultModel: vi.fn(() => 'gpt-5'),
  validateModelId: vi.fn(),
  getAllOpenKosmosUsedModels: vi.fn(),
}));

vi.mock('../../llm/ghcModelApi', async () => ({
  getEndpointForModel: vi.fn(),
}));

vi.mock('../../auth/authManager', async () => ({
  mainAuthManager: {},
}));

vi.mock('../../unifiedLogger', async () => import('../../__mocks__/unifiedLogger'));

vi.mock('../../utilities/contentUtils', async () => ({
  formatFileSize: vi.fn(),
}));

vi.mock('../../userDataADO/openkosmosPlaceholders', async () => ({
  openkosmosPlaceholderManager: {},
  containsOpenKosmosPlaceholder: vi.fn(() => false),
}));

vi.mock('../../userDataADO/userInputPlaceholderParser', async () => ({
  userInputPlaceholderParser: {},
  UserInputField: class UserInputField {},
}));

vi.mock('../../mem0/openkosmos-adapters/OpenKosmosMemoryManager', async () => ({
  openkosmosMemoryManager: {},
}));

vi.mock('../../llm/chatSessionTitleLlmSummarizer', async () => ({
  ChatSessionTitleLlmSummarizer: class ChatSessionTitleLlmSummarizer {},
}));

const { mockProfileCacheManager } = vi.hoisted(() => ({
  mockProfileCacheManager: {
    getChatConfig: vi.fn(),
    getCachedProfile: vi.fn(() => ({ skills: [] })),
    updateChatSkillSnapshot: vi.fn().mockResolvedValue(true),
  },
}));

vi.mock('../../userDataADO/profileCacheManager', async () => ({
  profileCacheManager: mockProfileCacheManager,
}));

vi.mock('../chatSessionStore', async () => ({
  chatSessionStore: {},
}));

vi.mock('../../skill/skillManager', async () => ({
  skillManager: {},
}));

vi.mock('../globalSystemPrompt', async () => ({
  getGlobalSystemPromptAsMessages: vi.fn(() => []),
}));

vi.mock('../../featureFlags', async () => ({
  featureFlagManager: {},
  isFeatureEnabled: vi.fn(() => false),
}));

vi.mock('../../cancellation', async () => ({
  CancellationToken: class CancellationToken {},
  CancellationError: class CancellationError extends Error {},
  CancellationTokenStatic: {},
}));

vi.mock('../../token', async () => ({
  createTokenCounter: vi.fn(() => ({ countTokens: vi.fn(() => 0) })),
  TokenCounter: class TokenCounter {},
}));

vi.mock('../../compression/fullModeCompressor', async () => ({
  createFullModeCompressor: vi.fn(() => ({})),
  FullModeCompressor: class FullModeCompressor {},
}));

vi.mock('../agentChatUtilities', async () => ({
  normalizeToolCalls: vi.fn(),
  detectTruncatedToolCalls: vi.fn(),
  sanitizeToolCallsForApi: vi.fn(),
  applyStorageCompressionToRecentMessages: vi.fn(),
}));

import { AgentChat, ChatStatus } from '../agentChat';

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeAgentConfig() {
  return {
    chat_id: 'chat-1',
    agent: {
      role: 'assistant',
      emoji: '🤖',
      name: 'OpenKosmos',
      model: 'gpt-5',
      mcp_servers: [],
      system_prompt: '',
    },
  };
}

function createAgentChat(): AgentChat {
  mockProfileCacheManager.getChatConfig.mockReturnValue(makeAgentConfig());

  return new AgentChat('alice', 'chat-1', 'session-1', {
    chat_history: [],
    context_history: [],
    interaction_history: [],
    title: 'Test Chat',
    last_updated: '2026-01-01T00:00:00.000Z',
  } as any);
}

function textMsg(text: string, role: 'user' | 'assistant', id: string, timestamp?: number | string): Message {
  return {
    id,
    role,
    timestamp: timestamp ?? Date.now(),
    content: [{ type: 'text', text }],
  } as any;
}

// ─── getMessageTimestampMs ────────────────────────────────────────────────────

describe('AgentChat.getMessageTimestampMs', () => {
  let agent: AgentChat;
  beforeEach(() => { agent = createAgentChat(); });

  it('returns a numeric timestamp directly when it is finite', () => {
    const msg = textMsg('hi', 'user', 'u1', 1_700_000_000_000);
    const ts = (agent as any).getMessageTimestampMs(msg);
    expect(ts).toBe(1_700_000_000_000);
  });

  it('parses an ISO string timestamp', () => {
    const msg = textMsg('hi', 'user', 'u1', '2024-01-15T12:00:00.000Z');
    const ts = (agent as any).getMessageTimestampMs(msg);
    expect(ts).toBe(Date.parse('2024-01-15T12:00:00.000Z'));
  });

  it('falls back to Date.now() for invalid string timestamps', () => {
    const before = Date.now();
    const msg = textMsg('hi', 'user', 'u1', 'not-a-date');
    const ts = (agent as any).getMessageTimestampMs(msg);
    const after = Date.now();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it('falls back to Date.now() for Infinity', () => {
    const before = Date.now();
    const msg = textMsg('hi', 'user', 'u1', Infinity);
    const ts = (agent as any).getMessageTimestampMs(msg);
    const after = Date.now();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });
});

// ─── getAnalyticsDayKey ───────────────────────────────────────────────────────

describe('AgentChat.getAnalyticsDayKey', () => {
  let agent: AgentChat;
  beforeEach(() => { agent = createAgentChat(); });

  it('produces YYYY-MM-DD in UTC+8 from a UTC timestamp', () => {
    // 2024-01-15T16:00:00Z  →  2024-01-16T00:00:00+08  →  day key = 2024-01-16
    const ts = Date.parse('2024-01-15T16:00:00.000Z');
    const key = (agent as any).getAnalyticsDayKey(ts);
    expect(key).toBe('2024-01-16');
  });

  it('pads month and day with leading zero', () => {
    // 2024-03-05T00:00:00+08  →  UTC = 2024-03-04T16:00:00Z
    const ts = Date.parse('2024-03-04T16:00:00.000Z');
    const key = (agent as any).getAnalyticsDayKey(ts);
    expect(key).toBe('2024-03-05');
  });
});

// ─── shouldTrackChatSessionActivatedForUserMessage ────────────────────────────

describe('AgentChat.shouldTrackChatSessionActivatedForUserMessage', () => {
  it('returns true for the first user message on a given day (empty history)', () => {
    const agent = createAgentChat();
    const msg = textMsg('hello', 'user', 'u1', Date.now());
    expect((agent as any).shouldTrackChatSessionActivatedForUserMessage(msg)).toBe(true);
  });

  it('returns false for non-user messages', () => {
    const agent = createAgentChat();
    const msg = textMsg('reply', 'assistant', 'a1', Date.now());
    expect((agent as any).shouldTrackChatSessionActivatedForUserMessage(msg)).toBe(false);
  });

  it('returns false when a user message already exists on the same day', () => {
    const agent = createAgentChat();
    const ts = Date.parse('2024-06-01T08:00:00.000Z');
    // Seed chat history with an existing user message on the same UTC+8 day
    (agent as any).currentChatSession.chat_history.push(textMsg('earlier', 'user', 'u0', ts));
    const msg = textMsg('later', 'user', 'u1', ts + 1000);
    expect((agent as any).shouldTrackChatSessionActivatedForUserMessage(msg)).toBe(false);
  });

  it('returns true when the existing message is on a different day', () => {
    const agent = createAgentChat();
    const dayOneMidnight = Date.parse('2024-06-01T00:00:00.000Z'); // UTC+8 day: 2024-06-01
    const dayTwoMorning = Date.parse('2024-06-02T01:00:00.000Z');   // UTC+8 day: 2024-06-02
    (agent as any).currentChatSession.chat_history.push(textMsg('day1', 'user', 'u0', dayOneMidnight));
    const msg = textMsg('day2', 'user', 'u1', dayTwoMorning);
    expect((agent as any).shouldTrackChatSessionActivatedForUserMessage(msg)).toBe(true);
  });
});

// ─── getChatSessionEntryTypeForUserMessage ────────────────────────────────────

describe('AgentChat.getChatSessionEntryTypeForUserMessage', () => {
  it("returns 'new' when chat history is empty and message is a user message", () => {
    const agent = createAgentChat();
    const msg = textMsg('first', 'user', 'u1');
    expect((agent as any).getChatSessionEntryTypeForUserMessage(msg)).toBe('new');
  });

  it("returns 'continued' when chat history already has messages", () => {
    const agent = createAgentChat();
    (agent as any).currentChatSession.chat_history.push(textMsg('earlier', 'user', 'u0'));
    const msg = textMsg('second', 'user', 'u1');
    expect((agent as any).getChatSessionEntryTypeForUserMessage(msg)).toBe('continued');
  });

  it("returns 'continued' for an assistant message even in an empty history", () => {
    const agent = createAgentChat();
    const msg = textMsg('reply', 'assistant', 'a1');
    expect((agent as any).getChatSessionEntryTypeForUserMessage(msg)).toBe('continued');
  });
});

// ─── updateSessionTitle ───────────────────────────────────────────────────────

describe('AgentChat.updateSessionTitle', () => {
  it('updates the in-memory title and returns true', () => {
    const agent = createAgentChat();
    const result = agent.updateSessionTitle('New Title');
    expect(result).toBe(true);
    expect((agent as any).currentChatSession.title).toBe('New Title');
  });

  it('returns false when currentChatSession is null', () => {
    const agent = createAgentChat();
    (agent as any).currentChatSession = null;
    expect(agent.updateSessionTitle('Any')).toBe(false);
  });
});

// ─── forceIdleStatus ─────────────────────────────────────────────────────────

describe('AgentChat.forceIdleStatus', () => {
  it('does nothing when already idle', () => {
    const agent = createAgentChat();
    const setChatStatus = vi.spyOn(agent as any, 'setChatStatus');
    agent.forceIdleStatus();
    expect(setChatStatus).not.toHaveBeenCalled();
  });

  it('sets status to idle when currently non-idle', () => {
    const agent = createAgentChat();
    // Drive the status to non-idle via the public-facing state manager
    (agent as any).runtimeState.setChatStatus(ChatStatus.SENDING_RESPONSE);
    const setChatStatus = vi.spyOn(agent as any, 'setChatStatus');
    agent.forceIdleStatus();
    expect(setChatStatus).toHaveBeenCalledWith(ChatStatus.IDLE);
  });
});

// ─── getChatStatusInfo ────────────────────────────────────────────────────────

describe('AgentChat.getChatStatusInfo', () => {
  it('returns chatId, chatStatus and agentName', () => {
    const agent = createAgentChat();
    const info = agent.getChatStatusInfo();
    expect(info).toEqual({
      chatId: 'chat-1',
      chatStatus: ChatStatus.IDLE,
      agentName: 'OpenKosmos',
    });
  });
});

// ─── setSchedulerExecutionState / hydrateSchedulerMetadata ───────────────────

describe('AgentChat scheduler metadata', () => {
  it('setSchedulerExecutionState stores status', () => {
    const agent = createAgentChat();
    agent.setSchedulerExecutionState('running', { startedAt: '2026-01-01T00:00:00.000Z' });
    const meta = (agent as any).getSchedulerMetadata();
    expect(meta.schedulerExecutionStatus).toBe('running');
    expect(meta.schedulerStartedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(meta.schedulerCompletedAt).toBeUndefined();
  });

  it('setSchedulerExecutionState stores completedAt and error on failure', () => {
    const agent = createAgentChat();
    agent.setSchedulerExecutionState('failed', {
      completedAt: '2026-01-01T01:00:00.000Z',
      error: 'timeout',
    });
    const meta = (agent as any).getSchedulerMetadata();
    expect(meta.schedulerExecutionStatus).toBe('failed');
    expect(meta.schedulerCompletedAt).toBe('2026-01-01T01:00:00.000Z');
    expect(meta.schedulerError).toBe('timeout');
  });

  it('hydrateSchedulerMetadata populates scheduler fields', () => {
    const agent = createAgentChat();
    agent.hydrateSchedulerMetadata({
      schedulerJobId: 'job-42',
      schedulerExecutionStatus: 'completed',
      schedulerStartedAt: '2026-01-01T00:00:00.000Z',
      schedulerCompletedAt: '2026-01-01T01:00:00.000Z',
      schedulerError: undefined,
    });
    expect((agent as any).schedulerJobId).toBe('job-42');
    const meta = (agent as any).getSchedulerMetadata();
    expect(meta.schedulerJobId).toBe('job-42');
    expect(meta.schedulerExecutionStatus).toBe('completed');
  });
});

// ─── getContextSummary ────────────────────────────────────────────────────────

describe('AgentChat.getContextSummary', () => {
  it('returns empty string when context history is empty', () => {
    const agent = createAgentChat();
    expect(agent.getContextSummary()).toBe('');
  });

  it('builds a summary from context messages', () => {
    const agent = createAgentChat();
    (agent as any).currentChatSession.context_history = [
      textMsg('user question', 'user', 'u1'),
      textMsg('assistant reply', 'assistant', 'a1'),
    ];
    const summary = agent.getContextSummary();
    expect(summary).toContain('[user]: user question');
    expect(summary).toContain('[assistant]: assistant reply');
  });

  it('truncates long messages to 500 chars each', () => {
    const agent = createAgentChat();
    const longText = 'x'.repeat(600);
    (agent as any).currentChatSession.context_history = [
      textMsg(longText, 'user', 'u1'),
    ];
    const summary = agent.getContextSummary();
    const content = summary.replace('[user]: ', '');
    expect(content.length).toBeLessThanOrEqual(500);
  });

  it('only uses the last 20 messages', () => {
    const agent = createAgentChat();
    const msgs = Array.from({ length: 25 }, (_, i) =>
      textMsg(`msg ${i}`, 'user', `u${i}`)
    );
    (agent as any).currentChatSession.context_history = msgs;
    const summary = agent.getContextSummary();
    // msg 0–4 should not appear; msg 5–24 should
    expect(summary).not.toContain('msg 0');
    expect(summary).toContain('msg 5');
    expect(summary).toContain('msg 24');
  });
});

// ─── addContextChangeListener / removeContextChangeListener ──────────────────

describe('AgentChat context change listeners', () => {
  it('immediately delivers cached stats to a new listener', () => {
    const agent = createAgentChat();
    const cached = { contextHistory: 10, systemPrompt: 5, tools: 2, total: 17, limit: 128000 } as any;
    (agent as any).latestContextStats = cached;

    const listener = vi.fn();
    agent.addContextChangeListener(listener);
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(cached);
  });

  it('does not call a new listener if there are no cached stats', () => {
    const agent = createAgentChat();
    const listener = vi.fn();
    agent.addContextChangeListener(listener);
    expect(listener).not.toHaveBeenCalled();
  });

  it('removes a context change listener', () => {
    const agent = createAgentChat();
    const listener = vi.fn();
    agent.addContextChangeListener(listener);
    agent.removeContextChangeListener(listener);
    expect((agent as any).contextChangeListeners).not.toContain(listener);
  });
});

// ─── addStatusChangeListener ─────────────────────────────────────────────────

describe('AgentChat.addStatusChangeListener', () => {
  it('adds a listener and returns a disposer that removes it', () => {
    const agent = createAgentChat();
    const listener = vi.fn();
    const dispose = agent.addStatusChangeListener(listener);
    expect((agent as any).statusChangeListeners).toContain(listener);
    dispose();
    expect((agent as any).statusChangeListeners).not.toContain(listener);
  });
});

// ─── isCompressionEnabled / getCompressionStatus ─────────────────────────────

describe('AgentChat compression accessors', () => {
  it('isCompressionEnabled returns true when compressor is set', () => {
    const agent = createAgentChat();
    expect(agent.isCompressionEnabled()).toBe(true);
  });

  it('getCompressionStatus reflects current model', () => {
    const agent = createAgentChat();
    const status = agent.getCompressionStatus();
    expect(status.enabled).toBe(true);
    expect(status.fullModeCompressionReady).toBe(true);
    expect(status.currentModel).toBe('gpt-5');
  });
});

// ─── createMcpImageHash / hasInjectedMcpImageHash ────────────────────────────

describe('AgentChat MCP image hash helpers', () => {
  it('createMcpImageHash produces a hex MD5 string', () => {
    const agent = createAgentChat();
    const hash = (agent as any).createMcpImageHash('base64data', 'image/png');
    expect(hash).toMatch(/^[a-f0-9]{32}$/);
  });

  it('same data/mimeType produces the same hash', () => {
    const agent = createAgentChat();
    const h1 = (agent as any).createMcpImageHash('data', 'image/jpeg');
    const h2 = (agent as any).createMcpImageHash('data', 'image/jpeg');
    expect(h1).toBe(h2);
  });

  it('hasInjectedMcpImageHash returns false when chat history is empty', () => {
    const agent = createAgentChat();
    expect((agent as any).hasInjectedMcpImageHash('abc')).toBe(false);
  });

  it('hasInjectedMcpImageHash finds a hash previously injected into a user message', () => {
    const agent = createAgentChat();
    const hash = 'deadbeefdeadbeefdeadbeefdeadbeef';
    const userMsg: any = {
      id: 'u1',
      role: 'user',
      timestamp: Date.now(),
      content: [
        {
          type: 'image',
          image_url: { url: 'data:image/png;base64,abc' },
          metadata: { autoInjectedToolResultHash: hash },
        },
      ],
    };
    (agent as any).currentChatSession.chat_history.push(userMsg);
    expect((agent as any).hasInjectedMcpImageHash(hash)).toBe(true);
  });

  it('hasInjectedMcpImageHash returns false when hash does not match', () => {
    const agent = createAgentChat();
    const userMsg: any = {
      id: 'u1',
      role: 'user',
      timestamp: Date.now(),
      content: [
        {
          type: 'image',
          image_url: { url: 'data:image/png;base64,abc' },
          metadata: { autoInjectedToolResultHash: 'aaaa' },
        },
      ],
    };
    (agent as any).currentChatSession.chat_history.push(userMsg);
    expect((agent as any).hasInjectedMcpImageHash('bbbb')).toBe(false);
  });
});

// ─── destroy ─────────────────────────────────────────────────────────────────

describe('AgentChat.destroy', () => {
  it('clears listeners and resets status to IDLE', () => {
    const agent = createAgentChat();
    agent.addContextChangeListener(vi.fn());
    agent.addStatusChangeListener(vi.fn());
    (agent as any).latestContextStats = { total: 1 };
    (agent as any).runtimeState.setChatStatus(ChatStatus.SENDING_RESPONSE);

    agent.destroy();

    expect((agent as any).contextChangeListeners).toHaveLength(0);
    expect((agent as any).statusChangeListeners).toHaveLength(0);
    expect((agent as any).latestContextStats).toBeNull();
    expect(agent.getChatStatus()).toBe(ChatStatus.IDLE);
  });
});
