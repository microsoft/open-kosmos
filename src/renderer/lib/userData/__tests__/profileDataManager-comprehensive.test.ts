/**
 * @vitest-environment happy-dom
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────────

const profileEventMocks = {
  getProfile: vi.fn(),
  onCacheUpdated: vi.fn(),
  onAutoSelectChatSession: vi.fn(),
  onChatSessionStoreSessionCreated: vi.fn(),
  onChatSessionStoreMetadataPatched: vi.fn(),
  onChatSessionStoreSessionDeleted: vi.fn(),
};


const agentChatMocks = {
  onStreamingChunk: vi.fn(),
  onStreamingMetrics: vi.fn(),
  onToolUse: vi.fn(),
  onToolResult: vi.fn(),
  onContextChange: vi.fn(),
  onInteractionRequest: vi.fn(),
  onInteractionProcessed: vi.fn(),
  onChatStatusChanged: vi.fn(),
};

vi.mock('../../../lib/chat/agentChatSessionCacheManager', () => ({
  agentChatSessionCacheManager: {
    getCurrentChatId: vi.fn(() => null),
    onStreamingChunk: vi.fn(),
    onStreamingMetrics: vi.fn(),
    onToolUse: vi.fn(),
    onToolResult: vi.fn(),
    onContextChange: vi.fn(),
    onInteractionRequest: vi.fn(),
    onInteractionProcessed: vi.fn(),
    onChatStatusChanged: vi.fn(),
  },
}));

vi.mock('../../../lib/mcp/mcpClientCacheManager', () => ({
  mcpClientCacheManager: {
    updateServerConfigs: vi.fn(),
    refresh: vi.fn().mockResolvedValue(undefined),
    onServerStatesUpdated: vi.fn(() => vi.fn()),
  },
}));

Object.defineProperty(window, 'electronAPI', {
  value: {
    profile: profileEventMocks,
    mcp: { onServerStatesUpdated: vi.fn(() => vi.fn()) },
    agentChat: agentChatMocks,
  },
  writable: true,
  configurable: true,
});

import { ProfileDataManager } from '../profileDataManager';
import type { ProfileV2 } from '../../../../main/lib/userDataADO/types/profile';
import { agentChatSessionCacheManager } from '../../../lib/chat/agentChatSessionCacheManager';
import { mcpClientCacheManager } from '../../../lib/mcp/mcpClientCacheManager';
import { agentClientCacheManager } from '../../../lib/agent/agentClientCacheManager';
import type { AgentConfig } from '../../../../main/lib/userDataADO/types/agentStore';

// ── Helpers ───────────────────────────────────────────────────────────────────

function resetInstance(): ProfileDataManager {
  (ProfileDataManager as any).instance = null;
  return ProfileDataManager.getInstance();
}

function makeProfile(overrides: Partial<ProfileV2> = {}): ProfileV2 {
  return {
    version: '2.0.0',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    alias: 'testUser',
    freDone: true,
    primaryChat: 'chat-a',
    chats: [
      {
        chat_id: 'chat-1',
        chat_type: 'single_agent',
        agent: {
          name: 'Agent A',
          role: 'assistant',
          emoji: '🤖',
          avatar: '',
          version: '1.0.0',
          source: 'ON-DEVICE',
          workspace: '',
          mcp_servers: [],
          skills: [],
          model: 'gpt-4',
        },
        chatSessions: [],
      },
    ],
    skills: [],
    mcp_servers: [],
    'starred-chat-sessions': [],
    ...overrides,
  } as unknown as ProfileV2;
}

function initManager(manager: ProfileDataManager, alias = 'testUser', profile?: Partial<ProfileV2>): void {
  (manager as any).userAlias = alias;
  (manager as any).cache.isInitialized = true;
  (manager as any).cache.profile = makeProfile(profile);
  (manager as any).cache.chats = (manager as any).cache.profile.chats;
  (manager as any).cache.skills = (manager as any).cache.profile.skills || [];
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ProfileDataManager - Comprehensive', () => {
  let manager: ProfileDataManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = resetInstance();
  });

  afterEach(() => {
    (ProfileDataManager as any).instance = null;
  });

  // ── singleton ──────────────────────────────────────────────────────────────

  describe('singleton', () => {
    it('returns the same instance', () => {
      expect(ProfileDataManager.getInstance()).toBe(manager);
    });
  });

  // ── subscribe / unsubscribe ────────────────────────────────────────────────

  describe('subscribe()', () => {
    it('notifies listener on immediate notification', () => {
      initManager(manager);
      const listener = vi.fn();
      manager.subscribe(listener);
      (manager as any).notifyListeners(true);
      expect(listener).toHaveBeenCalled();
    });

    it('unsubscribe stops notifications', () => {
      initManager(manager);
      const listener = vi.fn();
      const unsub = manager.subscribe(listener);
      unsub();
      (manager as any).notifyListeners(true);
      expect(listener).not.toHaveBeenCalled();
    });
  });

  // ── getProfile / getCurrentUserAlias ──────────────────────────────────────

  describe('getProfile() / getCurrentUserAlias()', () => {
    it('returns null profile before init', () => {
      expect(manager.getProfile()).toBeNull();
    });

    it('returns profile after init', () => {
      initManager(manager);
      expect(manager.getProfile()).not.toBeNull();
    });

    it('returns null user alias before init', () => {
      expect(manager.getCurrentUserAlias()).toBeNull();
    });

    it('returns user alias after init', () => {
      initManager(manager);
      expect(manager.getCurrentUserAlias()).toBe('testUser');
    });
  });

  // ── getChatConfigs ─────────────────────────────────────────────────────────

  describe('getChatConfigs()', () => {
    it('returns empty array when not initialized', () => {
      expect(manager.getChatConfigs()).toEqual([]);
    });

    it('returns chat configs after init', () => {
      initManager(manager);
      expect(manager.getChatConfigs()).toHaveLength(1);
    });
  });

  // ── getCurrentChat ─────────────────────────────────────────────────────────

  describe('getCurrentChat()', () => {
    it('returns null when no chats', () => {
      expect(manager.getCurrentChat()).toBeNull();
    });

    it('returns first chat when currentChatId is null', () => {
      vi.mocked(agentChatSessionCacheManager.getCurrentChatId).mockReturnValue(null as any);
      initManager(manager);
      expect(manager.getCurrentChat()?.chat_id).toBe('chat-1');
    });

    it('returns chat matching currentChatId', () => {
      vi.mocked(agentChatSessionCacheManager.getCurrentChatId).mockReturnValue('chat-1');
      initManager(manager);
      expect(manager.getCurrentChat()?.chat_id).toBe('chat-1');
    });

    it('returns null when currentChatId does not match', () => {
      vi.mocked(agentChatSessionCacheManager.getCurrentChatId).mockReturnValue('chat-999');
      initManager(manager);
      expect(manager.getCurrentChat()).toBeNull();
    });
  });

  // ── getCurrentAgent / getCurrentModel ─────────────────────────────────────

  describe('getCurrentAgent() / getCurrentModel()', () => {
    it('returns null when no chat', () => {
      expect(manager.getCurrentAgent()).toBeNull();
      expect(manager.getCurrentModel()).toBeNull();
    });

    it('returns agent and model', () => {
      vi.mocked(agentChatSessionCacheManager.getCurrentChatId).mockReturnValue(null as any);
      initManager(manager);
      expect(manager.getCurrentAgent()?.name).toBe('Agent A');
      expect(manager.getCurrentModel()).toBe('gpt-4');
    });
  });

  // ── getSelectedModel ──────────────────────────────────────────────────────

  describe('getSelectedModel()', () => {
    it('returns null for unknown chatId', () => {
      initManager(manager);
      expect(manager.getSelectedModel('unknown')).toBeNull();
    });

    it('returns model for known chatId', () => {
      initManager(manager);
      expect(manager.getSelectedModel('chat-1')).toBe('gpt-4');
    });
  });

  // ── getReasoningEffort ────────────────────────────────────────────────────

  describe('getReasoningEffort()', () => {
    it('returns undefined when no effort set', () => {
      initManager(manager);
      expect(manager.getReasoningEffort('chat-1')).toBeUndefined();
    });

    it('returns lowercased effort value', () => {
      initManager(manager);
      (manager as any).cache.chats[0].agent.reasoningEffort = 'HIGH';
      expect(manager.getReasoningEffort('chat-1')).toBe('high');
    });

    it('returns undefined for empty string effort', () => {
      initManager(manager);
      (manager as any).cache.chats[0].agent.reasoningEffort = '';
      expect(manager.getReasoningEffort('chat-1')).toBeUndefined();
    });

    it('returns undefined for unknown chatId', () => {
      initManager(manager);
      expect(manager.getReasoningEffort('unknown')).toBeUndefined();
    });
  });

  // ── agent_ids-only chats (regression) ─────────────────────────────────────
  // Reproduces the ModelSelector "Select Model" bug: after the read-flip,
  // separated chats carry ONLY agent_ids (inline chat.agent stripped from the
  // renderer push). The imperative readers must resolve the agent through the
  // renderer agentClientCacheManager bridge (resolveChatAgent), NOT the
  // main-process accessor whose agent_ids resolver is never installed in the
  // renderer bundle (it defaults to () => [] there, so it returned undefined).
  describe('agent_ids-only chats resolve via agentClientCacheManager', () => {
    const AGENT_ID = 'agent_20260702000000_regress01';

    function seedCachedAgent(overrides: Partial<AgentConfig> = {}): void {
      const agent = {
        id: AGENT_ID,
        name: 'Cached Agent',
        role: 'assistant',
        emoji: '🧠',
        avatar: '',
        version: '1.0.0',
        source: 'ON-DEVICE',
        workspace: '',
        mcp_servers: [],
        skills: [],
        model: 'claude-opus-4.8',
        ...overrides,
      } as unknown as AgentConfig;
      (agentClientCacheManager as any).agents.set(agent.id, agent);
    }

    function initWithSeparatedChat(): void {
      // A chat with ONLY agent_ids and no inline agent facade.
      initManager(manager, 'testUser', {
        chats: [
          {
            chat_id: 'chat-sep',
            chat_type: 'single_agent',
            agent_ids: [AGENT_ID],
            chatSessions: [],
          },
        ],
      } as unknown as Partial<ProfileV2>);
    }

    afterEach(() => {
      (agentClientCacheManager as any).agents.clear();
    });

    it('getSelectedModel resolves the model from the agent store cache', () => {
      seedCachedAgent();
      initWithSeparatedChat();
      expect(manager.getSelectedModel('chat-sep')).toBe('claude-opus-4.8');
    });

    it('getSelectedModel returns null when the agent is not cached', () => {
      // No seedCachedAgent(): the id resolves to nothing in the renderer cache.
      initWithSeparatedChat();
      expect(manager.getSelectedModel('chat-sep')).toBeNull();
    });

    it('getCurrentAgent resolves the primary agent from the cache', () => {
      seedCachedAgent();
      initWithSeparatedChat();
      vi.mocked(agentChatSessionCacheManager.getCurrentChatId).mockReturnValue('chat-sep');
      expect(manager.getCurrentAgent()?.name).toBe('Cached Agent');
      expect(manager.getCurrentModel()).toBe('claude-opus-4.8');
    });

    it('getReasoningEffort resolves the effort from the cached agent', () => {
      seedCachedAgent({ reasoningEffort: 'HIGH' } as Partial<AgentConfig>);
      initWithSeparatedChat();
      expect(manager.getReasoningEffort('chat-sep')).toBe('high');
    });
  });

  // ── getAssignedMcpServers ─────────────────────────────────────────────────

  describe('getAssignedMcpServers()', () => {
    it('returns empty array when no current agent', () => {
      expect(manager.getAssignedMcpServers()).toEqual([]);
    });

    it('returns mcp_servers from current agent', () => {
      vi.mocked(agentChatSessionCacheManager.getCurrentChatId).mockReturnValue(null as any);
      initManager(manager);
      (manager as any).cache.chats[0].agent.mcp_servers = [{ name: 'server1', tools: [] }];
      expect(manager.getAssignedMcpServers()).toHaveLength(1);
    });
  });

  // ── skills ────────────────────────────────────────────────────────────────

  describe('skills', () => {
    it('getSkills() returns empty array when no skills', () => {
      expect(manager.getSkills()).toEqual([]);
    });

    it('getSkillByName() returns null when not found', () => {
      expect(manager.getSkillByName('unknown')).toBeNull();
    });

    it('getSkillByName() finds skill by name', () => {
      (manager as any).cache.skills = [{ name: 'search', description: 'web search' }];
      expect(manager.getSkillByName('search')).toMatchObject({ name: 'search' });
    });

    it('getSkillsStats() returns correct count', () => {
      (manager as any).cache.skills = [{ name: 'a' }, { name: 'b' }];
      expect(manager.getSkillsStats()).toEqual({ totalSkills: 2 });
    });

    it('getCurrentAgentSkills() returns empty when no agent', () => {
      expect(manager.getCurrentAgentSkills()).toEqual([]);
    });

    it('getCurrentAgentSkills() maps skill names to SkillConfig', () => {
      vi.mocked(agentChatSessionCacheManager.getCurrentChatId).mockReturnValue(null as any);
      initManager(manager);
      (manager as any).cache.skills = [{ name: 'search', description: 'web search' }];
      (manager as any).cache.chats[0].agent.skills = ['search', 'nonexistent'];
      const result = manager.getCurrentAgentSkills();
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('search');
    });
  });

  // ── FRE ───────────────────────────────────────────────────────────────────

  describe('FRE', () => {
    it('getFreDone() returns false when no profile', () => {
      expect(manager.getFreDone()).toBe(false);
    });

    it('getFreDone() returns true when freDone is true', () => {
      initManager(manager, 'testUser', { freDone: true });
      expect(manager.getFreDone()).toBe(true);
    });

    it('getFreDone() returns false when freDone is false', () => {
      initManager(manager, 'testUser', { freDone: false });
      expect(manager.getFreDone()).toBe(false);
    });

    it('needsFRE() returns false when not initialized', () => {
      expect(manager.needsFRE()).toBe(false);
    });

    it('needsFRE() returns false when freDone is true', () => {
      initManager(manager, 'testUser', { freDone: true });
      expect(manager.needsFRE()).toBe(false);
    });

    it('needsFRE() returns true when freDone is false', () => {
      initManager(manager, 'testUser', { freDone: false });
      expect(manager.needsFRE()).toBe(true);
    });
  });

  // ── isDataStale ───────────────────────────────────────────────────────────

  describe('isDataStale()', () => {
    it('returns true when lastUpdated is 0', () => {
      expect(manager.isDataStale()).toBe(true);
    });

    it('returns false when recently updated', () => {
      (manager as any).cache.lastUpdated = Date.now();
      expect(manager.isDataStale(5000)).toBe(false);
    });
  });

  // ── ChatSessions ──────────────────────────────────────────────────────────

  describe('ChatSessions', () => {
    const session1 = {
      chatSession_id: 'sess-1',
      title: 'Session 1',
      last_updated: '2026-01-02T00:00:00.000Z',
    };
    const session2 = {
      chatSession_id: 'sess-2',
      title: 'Session 2',
      last_updated: '2026-01-01T00:00:00.000Z',
    };

    beforeEach(() => {
      initManager(manager);
      (manager as any).cache.chats[0].chatSessions = [session1, session2];
    });

    it('getChatSessions() returns sessions for chat', () => {
      expect(manager.getChatSessions('chat-1')).toHaveLength(2);
    });

    it('getChatSessions() returns empty for unknown chat', () => {
      expect(manager.getChatSessions('unknown')).toEqual([]);
    });

    it('getCurrentChatSessions() returns sessions for current chat', () => {
      vi.mocked(agentChatSessionCacheManager.getCurrentChatId).mockReturnValue(null as any);
      expect(manager.getCurrentChatSessions()).toHaveLength(2);
    });

    it('getCurrentChatSessions() returns empty when no current chat', () => {
      vi.mocked(agentChatSessionCacheManager.getCurrentChatId).mockReturnValue('unknown');
      expect(manager.getCurrentChatSessions()).toEqual([]);
    });

    it('getChatSession() finds by chatSessionId', () => {
      expect(manager.getChatSession('chat-1', 'sess-1')).toMatchObject({ chatSession_id: 'sess-1' });
    });

    it('getChatSession() returns null for missing session', () => {
      expect(manager.getChatSession('chat-1', 'missing')).toBeNull();
    });

    it('getCurrentChatSession() returns null when no current chat', () => {
      vi.mocked(agentChatSessionCacheManager.getCurrentChatId).mockReturnValue('unknown');
      expect(manager.getCurrentChatSession('sess-1')).toBeNull();
    });

    it('getCurrentChatSession() finds session in current chat', () => {
      vi.mocked(agentChatSessionCacheManager.getCurrentChatId).mockReturnValue(null as any);
      expect(manager.getCurrentChatSession('sess-1')).toMatchObject({ chatSession_id: 'sess-1' });
    });

    it('getChatSessionsStats() returns correct stats', () => {
      const stats = manager.getChatSessionsStats('chat-1');
      expect(stats.totalChatSessions).toBe(2);
      expect(stats.newestChatSession).toBe('sess-1');
      expect(stats.oldestChatSession).toBe('sess-2');
    });

    it('getChatSessionsStats() returns nulls for empty chat', () => {
      const stats = manager.getChatSessionsStats('unknown');
      expect(stats).toEqual({
        totalChatSessions: 0,
        lastUpdated: null,
        oldestChatSession: null,
        newestChatSession: null,
      });
    });

    it('getCurrentChatSessionsStats() returns empty stats when no current chat', () => {
      vi.mocked(agentChatSessionCacheManager.getCurrentChatId).mockReturnValue('unknown');
      const stats = manager.getCurrentChatSessionsStats();
      expect(stats.totalChatSessions).toBe(0);
    });

    it('getCurrentChatSessionsStats() returns stats for current chat', () => {
      vi.mocked(agentChatSessionCacheManager.getCurrentChatId).mockReturnValue(null as any);
      const stats = manager.getCurrentChatSessionsStats();
      expect(stats.totalChatSessions).toBe(2);
    });
  });

  // ── prompt history ────────────────────────────────────────────────────────

  describe('prompt history', () => {
    it('addPromptToHistory ignores blank prompts', () => {
      manager.addPromptToHistory('');
      manager.addPromptToHistory('   ');
      expect(manager.getPromptHistoryStats().total).toBe(0);
    });

    it('addPromptToHistory ignores duplicate consecutive prompts', () => {
      manager.addPromptToHistory('hello');
      manager.addPromptToHistory('hello');
      expect(manager.getPromptHistoryStats().total).toBe(1);
    });

    it('getPreviousPrompt() returns null when history empty', () => {
      expect(manager.getPreviousPrompt()).toBeNull();
    });

    it('getPreviousPrompt() navigates backwards', () => {
      manager.addPromptToHistory('first');
      manager.addPromptToHistory('second');
      expect(manager.getPreviousPrompt()).toBe('second');
      expect(manager.getPreviousPrompt()).toBe('first');
      // Already at head, stays at first
      expect(manager.getPreviousPrompt()).toBe('first');
    });

    it('getNextPrompt() returns null when history empty', () => {
      expect(manager.getNextPrompt()).toBeNull();
    });

    it('getNextPrompt() returns currentEditingPrompt when at tail', () => {
      manager.addPromptToHistory('one');
      manager.setCurrentEditingPrompt('draft');
      // cursor is at -1
      expect(manager.getNextPrompt()).toBe('draft');
    });

    it('getNextPrompt() navigates forward after going back', () => {
      manager.addPromptToHistory('first');
      manager.addPromptToHistory('second');
      manager.setCurrentEditingPrompt('draft');
      manager.getPreviousPrompt(); // goes to second
      manager.getPreviousPrompt(); // goes to first
      expect(manager.getNextPrompt()).toBe('second');
      // At tail again, returns editing prompt
      expect(manager.getNextPrompt()).toBe('draft');
    });

    it('setCurrentEditingPrompt resets cursor', () => {
      manager.addPromptToHistory('hello');
      manager.getPreviousPrompt(); // cursor = 0
      manager.setCurrentEditingPrompt('new');
      expect(manager.isBrowsingHistory()).toBe(false);
      expect(manager.getCurrentEditingPrompt()).toBe('new');
    });

    it('isBrowsingHistory() returns false initially', () => {
      expect(manager.isBrowsingHistory()).toBe(false);
    });

    it('isBrowsingHistory() returns true after navigating', () => {
      manager.addPromptToHistory('test');
      manager.getPreviousPrompt();
      expect(manager.isBrowsingHistory()).toBe(true);
    });

    it('getPromptHistoryStats() returns correct stats', () => {
      manager.addPromptToHistory('a');
      manager.addPromptToHistory('b');
      manager.getPreviousPrompt();
      const stats = manager.getPromptHistoryStats();
      expect(stats.total).toBe(2);
      expect(stats.current).toBe(1);
      expect(stats.maxSize).toBeGreaterThan(0);
    });

    it('enforces max queue size', () => {
      const max = (manager as any).HISTORY_PROMPT_QUEUE_SIZE;
      for (let i = 0; i < max + 5; i++) {
        manager.addPromptToHistory(`prompt-${i}`);
      }
      expect(manager.getPromptHistoryStats().total).toBe(max);
    });
  });

  // ── cleanup ───────────────────────────────────────────────────────────────

  describe('cleanup()', () => {
    it('resets all cache fields and notifies listeners', () => {
      initManager(manager);
      const listener = vi.fn();
      manager.subscribe(listener);
      manager.cleanup();

      expect(manager.getProfile()).toBeNull();
      expect(manager.isDataStale()).toBe(true);
      expect((manager as any).userAlias).toBeNull();
      expect(listener).toHaveBeenCalled();
    });

    it('clears pending notification timer', () => {
      vi.useFakeTimers();
      initManager(manager);
      (manager as any).pendingNotification = true;
      (manager as any).notificationTimeout = setTimeout(() => {}, 5000);
      manager.cleanup();
      expect((manager as any).notificationTimeout).toBeNull();
      vi.useRealTimers();
    });
  });

  // ── handleProfileCacheUpdate internals ────────────────────────────────────

  describe('handleProfileCacheUpdate()', () => {
    it('ignores updates for wrong alias', () => {
      initManager(manager);
      (manager as any).handleProfileCacheUpdate({
        alias: 'other',
        profile: makeProfile({ alias: 'other', freDone: false }),
        timestamp: Date.now(),
      });
      expect(manager.getFreDone()).toBe(true); // unchanged
    });

    it('ignores stale events (timestamp < lastUpdated)', () => {
      initManager(manager);
      const originalLastUpdated = Date.now() + 10000;
      (manager as any).cache.lastUpdated = originalLastUpdated;

      (manager as any).handleProfileCacheUpdate({
        alias: 'testUser',
        profile: makeProfile({ freDone: false }),
        timestamp: originalLastUpdated - 1,
      });
      expect(manager.getFreDone()).toBe(true); // unchanged
    });

    
    it('handles mcp_servers sync error gracefully', () => {
      vi.mocked(mcpClientCacheManager.updateServerConfigs).mockImplementationOnce(() => { throw new Error('mcp error'); });

      initManager(manager);
      // Should not throw:
      expect(() => {
        (manager as any).handleProfileCacheUpdate({
          alias: 'testUser',
          profile: makeProfile({ mcp_servers: [{ name: 'srv' }] as any }),
          timestamp: Date.now() + 99999,
        });
      }).not.toThrow();
    });

    
    
    it('refreshes MCP inventory when Computer Use enabled changes through cache updates', () => {
      initManager(manager, 'testUser', { computerUse: { enabled: false, alwaysAllowedApps: [], requireConfirmation: true } });
      vi.mocked(mcpClientCacheManager.refresh).mockClear();

      (manager as any).handleProfileCacheUpdate({
        alias: 'testUser',
        profile: makeProfile({ computerUse: { enabled: true, alwaysAllowedApps: [], requireConfirmation: true } }),
        timestamp: Date.now() + 99999,
      });

      expect(mcpClientCacheManager.refresh).toHaveBeenCalledTimes(1);
    });
  });

  // ── handleAutoSelectChatSession ───────────────────────────────────────────

  describe('handleAutoSelectChatSession()', () => {
    it('ignores events for wrong alias', () => {
      initManager(manager);
      // Should not throw:
      (manager as any).handleAutoSelectChatSession({
        alias: 'other',
        chatId: 'chat-1',
        chatSessionId: 'sess-1',
        timestamp: Date.now(),
      });
    });

    it('warns when chat is not found', () => {
      initManager(manager);
      // Should not throw:
      (manager as any).handleAutoSelectChatSession({
        alias: 'testUser',
        chatId: 'nonexistent',
        chatSessionId: 'sess-1',
        timestamp: Date.now(),
      });
    });

    it('warns when chatSession is not found', () => {
      initManager(manager);
      (manager as any).cache.chats[0].chatSessions = [];
      // Should not throw:
      (manager as any).handleAutoSelectChatSession({
        alias: 'testUser',
        chatId: 'chat-1',
        chatSessionId: 'missing-session',
        timestamp: Date.now(),
      });
    });

    it('succeeds when chat and session exist', () => {
      initManager(manager);
      (manager as any).cache.chats[0].chatSessions = [
        { chatSession_id: 'sess-1', title: 'S', last_updated: '2026-01-01T00:00:00.000Z' },
      ];
      // Should not throw:
      (manager as any).handleAutoSelectChatSession({
        alias: 'testUser',
        chatId: 'chat-1',
        chatSessionId: 'sess-1',
        timestamp: Date.now(),
      });
    });
  });

  // ── handleChatSessionStoreSessionCreated ──────────────────────────────────

  describe('handleChatSessionStoreSessionCreated()', () => {
    it('ignores events for wrong alias', () => {
      initManager(manager);
      const before = manager.getChatSessions('chat-1').length;
      (manager as any).handleChatSessionStoreSessionCreated({
        alias: 'other',
        chatId: 'chat-1',
        session: { chatSession_id: 'new', title: 'New', last_updated: '2026-01-01T00:00:00.000Z' },
        timestamp: Date.now(),
      });
      expect(manager.getChatSessions('chat-1').length).toBe(before);
    });

    it('ignores events for unknown chatId', () => {
      initManager(manager);
      (manager as any).handleChatSessionStoreSessionCreated({
        alias: 'testUser',
        chatId: 'unknown-chat',
        session: { chatSession_id: 'new', title: 'New', last_updated: '2026-01-01T00:00:00.000Z' },
        timestamp: Date.now(),
      });
    });

    it('adds new session to the correct chat', () => {
      initManager(manager);
      (manager as any).handleChatSessionStoreSessionCreated({
        alias: 'testUser',
        chatId: 'chat-1',
        session: { chatSession_id: 'new-sess', title: 'New', last_updated: '2026-02-01T00:00:00.000Z' },
        timestamp: Date.now(),
      });
      expect(manager.getChatSession('chat-1', 'new-sess')).not.toBeNull();
    });
  });

  // ── handleChatSessionStoreMetadataPatched ─────────────────────────────────

  describe('handleChatSessionStoreMetadataPatched()', () => {
    it('ignores events for wrong alias', () => {
      initManager(manager);
      (manager as any).handleChatSessionStoreMetadataPatched({
        alias: 'other',
        chatId: 'chat-1',
        chatSessionId: 'sess-1',
        metadata: { chatSession_id: 'sess-1', title: 'Updated' },
        timestamp: Date.now(),
      });
    });

    it('ignores unknown chatId', () => {
      initManager(manager);
      (manager as any).handleChatSessionStoreMetadataPatched({
        alias: 'testUser',
        chatId: 'unknown',
        chatSessionId: 'sess-1',
        metadata: { chatSession_id: 'sess-1', title: 'Updated' },
        timestamp: Date.now(),
      });
    });

    it('patches existing session', () => {
      initManager(manager);
      (manager as any).cache.chats[0].chatSessions = [
        { chatSession_id: 'sess-1', title: 'Original', last_updated: '2026-01-01T00:00:00.000Z' },
      ];
      (manager as any).handleChatSessionStoreMetadataPatched({
        alias: 'testUser',
        chatId: 'chat-1',
        chatSessionId: 'sess-1',
        metadata: { chatSession_id: 'sess-1', title: 'Patched', last_updated: '2026-02-01T00:00:00.000Z' },
        timestamp: Date.now(),
      });
      expect(manager.getChatSession('chat-1', 'sess-1')?.title).toBe('Patched');
    });

    it('appends metadata when session not found', () => {
      initManager(manager);
      (manager as any).cache.chats[0].chatSessions = [];
      (manager as any).handleChatSessionStoreMetadataPatched({
        alias: 'testUser',
        chatId: 'chat-1',
        chatSessionId: 'new-sess',
        metadata: { chatSession_id: 'new-sess', title: 'New', last_updated: '2026-02-01T00:00:00.000Z' },
        timestamp: Date.now(),
      });
      expect(manager.getChatSession('chat-1', 'new-sess')).not.toBeNull();
    });
  });

  // ── handleChatSessionStoreSessionDeleted ─────────────────────────────────

  describe('handleChatSessionStoreSessionDeleted()', () => {
    it('ignores events for wrong alias', () => {
      initManager(manager);
      (manager as any).cache.chats[0].chatSessions = [
        { chatSession_id: 'sess-1', title: 'S', last_updated: '2026-01-01T00:00:00.000Z' },
      ];
      (manager as any).handleChatSessionStoreSessionDeleted({
        alias: 'other',
        chatId: 'chat-1',
        chatSessionId: 'sess-1',
        timestamp: Date.now(),
      });
      expect(manager.getChatSessions('chat-1')).toHaveLength(1);
    });

    it('removes session', () => {
      initManager(manager);
      (manager as any).cache.chats[0].chatSessions = [
        { chatSession_id: 'sess-1', title: 'S', last_updated: '2026-01-01T00:00:00.000Z' },
      ];
      (manager as any).handleChatSessionStoreSessionDeleted({
        alias: 'testUser',
        chatId: 'chat-1',
        chatSessionId: 'sess-1',
        timestamp: Date.now(),
      });
      expect(manager.getChatSessions('chat-1')).toHaveLength(0);
    });
  });

  // ── refresh ───────────────────────────────────────────────────────────────

  describe('refresh()', () => {
    it('throws when userAlias is not set', async () => {
      await expect(manager.refresh()).rejects.toThrow('User alias not set');
    });

    it('calls getProfile with userAlias', async () => {
      initManager(manager);
      profileEventMocks.getProfile.mockResolvedValue({ success: true, data: makeProfile() });
      await manager.refresh();
      expect(profileEventMocks.getProfile).toHaveBeenCalledWith('testUser');
      expect(mcpClientCacheManager.refresh).toHaveBeenCalled();
    });

    it('handles getProfile failure gracefully', async () => {
      initManager(manager);
      profileEventMocks.getProfile.mockResolvedValue({ success: false });
      await expect(manager.refresh()).resolves.not.toThrow();
    });
  });

  // ── initialize ────────────────────────────────────────────────────────────

  describe('initialize()', () => {
    it('throws when alias is empty', async () => {
      await expect(manager.initialize('')).rejects.toThrow();
    });

    it('skips re-init when same alias and already initialized', async () => {
      (manager as any).userAlias = 'testUser';
      (manager as any).cache.isInitialized = true;
      profileEventMocks.getProfile.mockResolvedValue({ success: true, data: makeProfile() });
      await manager.initialize('testUser');
      expect(profileEventMocks.getProfile).not.toHaveBeenCalled();
    });

    it('handles getProfile timeout gracefully', async () => {
      vi.useFakeTimers();
      (manager as any).userAlias = null;
      profileEventMocks.getProfile.mockReturnValue(new Promise(() => {})); // never resolves

      const initPromise = manager.initialize('user1');
      await vi.advanceTimersByTimeAsync(16000);
      await initPromise; // should resolve without throw

      vi.useRealTimers();
    });
  });

  // ── buildStarredChatSessionIndexItem ─────────────────────────────────────

  describe('buildStarredChatSessionIndexItem()', () => {
    it('returns null when chat not found', () => {
      initManager(manager);
      const result = (manager as any).buildStarredChatSessionIndexItem('unknown-chat', {
        chatSession_id: 's1',
        title: 'T',
        last_updated: '2026-01-01T00:00:00.000Z',
      });
      expect(result).toBeNull();
    });

    it('returns null when session fields missing', () => {
      initManager(manager);
      const result = (manager as any).buildStarredChatSessionIndexItem('chat-1', {});
      expect(result).toBeNull();
    });

    it('returns StarredChatSessionIndexItem with agent fields', () => {
      initManager(manager);
      const result = (manager as any).buildStarredChatSessionIndexItem('chat-1', {
        chatSession_id: 's1',
        title: 'My session',
        last_updated: '2026-01-01T00:00:00.000Z',
        starredAt: '2026-01-01T00:00:00.000Z',
      });
      expect(result).toMatchObject({
        chatId: 'chat-1',
        chatSessionId: 's1',
        agentName: 'Agent A',
      });
    });
  });

  // ── syncStarredChatSessionInProfile ──────────────────────────────────────

  describe('syncStarredChatSessionInProfile()', () => {
    it('does nothing when profile is null', () => {
      (manager as any).cache.profile = null;
      expect(() => {
        (manager as any).syncStarredChatSessionInProfile('chat-1', { chatSession_id: 's1', starred: true });
      }).not.toThrow();
    });

    it('removes scheduled sessions from starred list', () => {
      initManager(manager);
      (manager as any).cache.profile['starred-chat-sessions'] = [
        { chatSessionId: 's1', chatId: 'chat-1' },
      ];
      (manager as any).syncStarredChatSessionInProfile('chat-1', {
        chatSession_id: 's1',
        schedulerJobId: 'job-1',
      });
      expect((manager as any).cache.profile['starred-chat-sessions']).toEqual([]);
    });

    it('returns early when shouldRemove and shouldTrack are both false', () => {
      initManager(manager);
      (manager as any).cache.profile['starred-chat-sessions'] = [];
      // No starred flag, no existing item -> shouldTrack=false, shouldRemove=false
      (manager as any).syncStarredChatSessionInProfile('chat-1', {
        chatSession_id: 's-new',
      });
      expect((manager as any).cache.profile['starred-chat-sessions']).toEqual([]);
    });
  });

  // ── removeStarredChatSessionFromProfile ───────────────────────────────────

  describe('removeStarredChatSessionFromProfile()', () => {
    it('does nothing when profile is null', () => {
      (manager as any).cache.profile = null;
      expect(() => {
        (manager as any).removeStarredChatSessionFromProfile('s1');
      }).not.toThrow();
    });

    it('does nothing when item not in list', () => {
      initManager(manager);
      (manager as any).cache.profile['starred-chat-sessions'] = [
        { chatSessionId: 's1', chatId: 'chat-1' },
      ];
      (manager as any).removeStarredChatSessionFromProfile('s-other');
      expect((manager as any).cache.profile['starred-chat-sessions']).toHaveLength(1);
    });
  });

  // ── debounced notification ────────────────────────────────────────────────

  describe('debounced notifyListeners()', () => {
    it('debounces multiple rapid calls', async () => {
      vi.useFakeTimers();
      initManager(manager);
      const listener = vi.fn();
      manager.subscribe(listener);

      (manager as any).notifyListeners(false);
      (manager as any).notifyListeners(false);
      (manager as any).notifyListeners(false);

      await vi.advanceTimersByTimeAsync(300);
      // Should only be called once due to debounce
      expect(listener).toHaveBeenCalledTimes(1);

      vi.useRealTimers();
    });
  });
});
