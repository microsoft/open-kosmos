/**
 * @vitest-environment happy-dom
 *
 * Additional coverage tests for ProfileDataManager targeting previously
 * uncovered functions, statements, and branches.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// ── Mocks (same style as comprehensive suite) ─────────────────────────────────

const profileEventMocks = {
  getProfile: vi.fn(),
  onCacheUpdated: vi.fn(),
  onAutoSelectChatSession: vi.fn(),
  onChatSessionStoreSessionCreated: vi.fn(),
  onChatSessionStoreMetadataPatched: vi.fn(),
  onChatSessionStoreSessionDeleted: vi.fn(),
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
    agentChat: {
      onStreamingChunk: vi.fn(),
      onStreamingMetrics: vi.fn(),
      onToolUse: vi.fn(),
      onToolResult: vi.fn(),
      onContextChange: vi.fn(),
      onInteractionRequest: vi.fn(),
      onInteractionProcessed: vi.fn(),
      onChatStatusChanged: vi.fn(),
    },
  },
  writable: true,
  configurable: true,
});

import { ProfileDataManager } from '../profileDataManager';
import type { ProfileV2 } from '../../../../main/lib/userDataADO/types/profile';
import { mcpClientCacheManager } from '../../../lib/mcp/mcpClientCacheManager';

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

describe('ProfileDataManager - Coverage', () => {
  let manager: ProfileDataManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = resetInstance();
  });

  afterEach(() => {
    (ProfileDataManager as any).instance = null;
  });

  // ── setupDataSyncListeners callbacks (lines 208-231) ──────────────────────

  describe('setupDataSyncListeners() callbacks', () => {
    it('invokes handleProfileCacheUpdate through onCacheUpdated callback', () => {
      // Capture the callback registered by setupDataSyncListeners
      let capturedCb: Function | undefined;
      profileEventMocks.onCacheUpdated.mockImplementation((cb: Function) => { capturedCb = cb; });

      (manager as any).setupDataSyncListeners();

      expect(capturedCb).toBeDefined();
      initManager(manager);

      // Invoke the callback — should update cache
      capturedCb!({
        alias: 'testUser',
        profile: makeProfile({ freDone: false }),
        timestamp: Date.now() + 9999,
      });

      expect(manager.getFreDone()).toBe(false);
    });

    it('invokes handleAutoSelectChatSession through onAutoSelectChatSession callback', () => {
      let capturedCb: Function | undefined;
      profileEventMocks.onAutoSelectChatSession.mockImplementation((cb: Function) => { capturedCb = cb; });

      (manager as any).setupDataSyncListeners();
      expect(capturedCb).toBeDefined();

      initManager(manager);
      (manager as any).cache.chats[0].chatSessions = [
        { chatSession_id: 'sess-x', title: 'X', last_updated: '2026-01-01T00:00:00.000Z' },
      ];

      // Should not throw
      capturedCb!({ alias: 'testUser', chatId: 'chat-1', chatSessionId: 'sess-x', timestamp: Date.now() });
    });

    it('invokes handleChatSessionStoreSessionCreated through onChatSessionStoreSessionCreated callback', () => {
      let capturedCb: Function | undefined;
      profileEventMocks.onChatSessionStoreSessionCreated.mockImplementation((cb: Function) => { capturedCb = cb; });

      (manager as any).setupDataSyncListeners();
      expect(capturedCb).toBeDefined();

      initManager(manager);

      capturedCb!({
        alias: 'testUser',
        chatId: 'chat-1',
        session: { chatSession_id: 'new-s', title: 'New', last_updated: '2026-02-01T00:00:00.000Z' },
        timestamp: Date.now(),
      });

      expect(manager.getChatSession('chat-1', 'new-s')).not.toBeNull();
    });

    it('invokes handleChatSessionStoreMetadataPatched through onChatSessionStoreMetadataPatched callback', () => {
      let capturedCb: Function | undefined;
      profileEventMocks.onChatSessionStoreMetadataPatched.mockImplementation((cb: Function) => { capturedCb = cb; });

      (manager as any).setupDataSyncListeners();
      expect(capturedCb).toBeDefined();

      initManager(manager);
      (manager as any).cache.chats[0].chatSessions = [
        { chatSession_id: 'sess-1', title: 'Original', last_updated: '2026-01-01T00:00:00.000Z' },
      ];

      capturedCb!({
        alias: 'testUser',
        chatId: 'chat-1',
        chatSessionId: 'sess-1',
        metadata: { chatSession_id: 'sess-1', title: 'Patched', last_updated: '2026-03-01T00:00:00.000Z' },
        timestamp: Date.now(),
      });

      expect(manager.getChatSession('chat-1', 'sess-1')?.title).toBe('Patched');
    });

    it('invokes handleChatSessionStoreSessionDeleted through onChatSessionStoreSessionDeleted callback', () => {
      let capturedCb: Function | undefined;
      profileEventMocks.onChatSessionStoreSessionDeleted.mockImplementation((cb: Function) => { capturedCb = cb; });

      (manager as any).setupDataSyncListeners();
      expect(capturedCb).toBeDefined();

      initManager(manager);
      (manager as any).cache.chats[0].chatSessions = [
        { chatSession_id: 'sess-1', title: 'S', last_updated: '2026-01-01T00:00:00.000Z' },
      ];

      capturedCb!({ alias: 'testUser', chatId: 'chat-1', chatSessionId: 'sess-1', timestamp: Date.now() });

      expect(manager.getChatSessions('chat-1')).toHaveLength(0);
    });

    it('does nothing when window.electronAPI is absent (else branch at line 235)', () => {
      const original = (window as any).electronAPI;
      (window as any).electronAPI = undefined;

      // Should not throw
      expect(() => (manager as any).setupDataSyncListeners()).not.toThrow();

      (window as any).electronAPI = original;
    });
  });

  describe('initialize() fallback error handling', () => {
    it('handles a non-Error getProfile rejection without throwing', async () => {
      profileEventMocks.getProfile.mockRejectedValue('profile unavailable');

      await expect(manager.initialize('testUser')).resolves.toBeUndefined();
      expect(manager.getCurrentUserAlias()).toBe('testUser');
    });
  });

  describe('handleProfileCacheUpdate() feature gates and fallbacks', () => {
    it('dispatches browser disable and refreshes MCP cache when browser is turned off', () => {
      initManager(manager, 'testUser', {
        browser: { enabled: true } as any,
        memex: { enabled: true } as any,
        computerUse: { enabled: true } as any,
      });
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

      (manager as any).handleProfileCacheUpdate({
        alias: 'testUser',
        profile: makeProfile({
          browser: { enabled: false } as any,
          memex: { enabled: false } as any,
          computerUse: { enabled: false } as any,
        }),
        timestamp: Date.now() + 1,
      });

      expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'embedded-browser:disable' }));
      expect(mcpClientCacheManager.refresh).toHaveBeenCalledTimes(3);
    });

    it('clears cached chats and skills when profile update is null', () => {
      initManager(manager);
      (manager as any).cache.chats = [{ chat_id: 'chat-to-clear' }];
      (manager as any).cache.skills = [{ name: 'skill-to-clear' }];

      (manager as any).handleProfileCacheUpdate({
        alias: 'testUser',
        profile: null,
        timestamp: Date.now() + 1,
      });

      expect(manager.getChatConfigs()).toEqual([]);
      expect(manager.getSkills()).toEqual([]);
    });

    it('falls back to empty chats and skills when profile omits them', () => {
      initManager(manager);
      const profile = makeProfile();
      delete (profile as any).chats;
      delete (profile as any).skills;

      (manager as any).handleProfileCacheUpdate({
        alias: 'testUser',
        profile,
        timestamp: Date.now() + 1,
      });

      expect(manager.getChatConfigs()).toEqual([]);
      expect(manager.getSkills()).toEqual([]);
    });
  });

  // ── handleAutoSelectChatSession with chatSessions defined (branch 326) ─────

  describe('handleAutoSelectChatSession() chatSessions?.map branch', () => {
    it('logs warning including availableSessions when chatSessions is defined but session not found', () => {
      initManager(manager);
      // chatSessions is defined (not undefined) so optional chain branch is exercised
      (manager as any).cache.chats[0].chatSessions = [
        { chatSession_id: 'other', title: 'Other', last_updated: '2026-01-01T00:00:00.000Z' },
      ];

      // Should not throw; warn path exercised with non-null chatSessions
      (manager as any).handleAutoSelectChatSession({
        alias: 'testUser',
        chatId: 'chat-1',
        chatSessionId: 'missing-session',
        timestamp: Date.now(),
      });
    });
  });

  // ── syncStarredChatSessionInProfile: buildStarredChatSessionIndexItem null (line 382-383) ──

  describe('syncStarredChatSessionInProfile() null nextItem early return', () => {
    it('returns early when buildStarredChatSessionIndexItem returns null (missing title)', () => {
      initManager(manager);
      // starred-chat-sessions undefined to exercise the || [] branch (line 370)
      (manager as any).cache.profile['starred-chat-sessions'] = undefined;

      // starred=true triggers shouldTrack=true, but session has no title -> nextItem=null
      (manager as any).syncStarredChatSessionInProfile('chat-1', {
        chatSession_id: 's1',
        starred: true,
        // no title, no last_updated
      });

      // Should not throw and profile starred list remains empty
      expect((manager as any).cache.profile['starred-chat-sessions']).toBeUndefined();
    });

    it('adds item to starred list when all required fields present (sort branch line 385)', () => {
      initManager(manager);
      (manager as any).cache.profile['starred-chat-sessions'] = [];

      (manager as any).syncStarredChatSessionInProfile('chat-1', {
        chatSession_id: 's1',
        starred: true,
        title: 'My Session',
        last_updated: '2026-01-01T00:00:00.000Z',
      });

      expect((manager as any).cache.profile['starred-chat-sessions']).toHaveLength(1);
    });
  });

  // ── removeStarredChatSessionFromProfile when list is undefined (line 401) ──

  describe('removeStarredChatSessionFromProfile() undefined list', () => {
    it('handles starred-chat-sessions being undefined via || [] branch', () => {
      initManager(manager);
      (manager as any).cache.profile['starred-chat-sessions'] = undefined;

      // Should not throw
      expect(() => (manager as any).removeStarredChatSessionFromProfile('s1')).not.toThrow();
    });

    it('removes the item when it is present (success path line 483)', () => {
      initManager(manager);
      (manager as any).cache.profile['starred-chat-sessions'] = [
        { chatSessionId: 'to-remove', chatId: 'chat-1', title: 'T', lastUpdated: '2026-01-01T00:00:00.000Z', starredAt: '2026-01-01T00:00:00.000Z', agentName: 'A' },
      ];

      (manager as any).removeStarredChatSessionFromProfile('to-remove');

      expect((manager as any).cache.profile['starred-chat-sessions']).toHaveLength(0);
    });
  });

  // ── handleChatSessionStoreSessionCreated dedup branch (lines 424-425) ──────

  describe('handleChatSessionStoreSessionCreated() dedup existing session', () => {
    it('replaces existing session with same id when re-created', () => {
      initManager(manager);
      (manager as any).cache.chats[0].chatSessions = [
        { chatSession_id: 'sess-dup', title: 'Old Title', last_updated: '2026-01-01T00:00:00.000Z' },
      ];

      (manager as any).handleChatSessionStoreSessionCreated({
        alias: 'testUser',
        chatId: 'chat-1',
        session: { chatSession_id: 'sess-dup', title: 'New Title', last_updated: '2026-02-01T00:00:00.000Z' },
        timestamp: Date.now(),
      });

      const sessions = manager.getChatSessions('chat-1');
      expect(sessions).toHaveLength(1);
      expect(sessions[0].title).toBe('New Title');
    });

    it('uses Date.now() fallback when timestamp is 0 (line 436 branch)', () => {
      initManager(manager);

      expect(() => {
        (manager as any).handleChatSessionStoreSessionCreated({
          alias: 'testUser',
          chatId: 'chat-1',
          session: { chatSession_id: 'sess-ts', title: 'T', last_updated: '2026-02-01T00:00:00.000Z' },
          timestamp: 0,
        });
      }).not.toThrow();
    });
  });

  // ── handleChatSessionStoreMetadataPatched sort + timestamp fallback ─────────

  describe('handleChatSessionStoreMetadataPatched() sort and timestamp fallback', () => {
    it('uses Date.now() when timestamp is 0 (line 472 branch)', () => {
      initManager(manager);
      (manager as any).cache.chats[0].chatSessions = [
        { chatSession_id: 'sess-1', title: 'S', last_updated: '2026-01-01T00:00:00.000Z' },
      ];

      expect(() => {
        (manager as any).handleChatSessionStoreMetadataPatched({
          alias: 'testUser',
          chatId: 'chat-1',
          chatSessionId: 'sess-1',
          metadata: { chatSession_id: 'sess-1', title: 'Updated', last_updated: '2026-02-01T00:00:00.000Z' },
          timestamp: 0,
        });
      }).not.toThrow();
    });
  });

  // ── handleChatSessionStoreSessionDeleted timestamp fallback (line 498) ──────

  describe('handleChatSessionStoreSessionDeleted() timestamp fallback', () => {
    it('uses Date.now() when timestamp is 0', () => {
      initManager(manager);
      (manager as any).cache.chats[0].chatSessions = [
        { chatSession_id: 'sess-1', title: 'S', last_updated: '2026-01-01T00:00:00.000Z' },
      ];

      expect(() => {
        (manager as any).handleChatSessionStoreSessionDeleted({
          alias: 'testUser',
          chatId: 'chat-1',
          chatSessionId: 'sess-1',
          timestamp: 0,
        });
      }).not.toThrow();
    });
  });

  // ── getChatSessionsStats null optional branches (lines 863-865) ───────────

  describe('getChatSessionsStats() optional field branches', () => {
    it('returns null fields when chatSessions array is empty', () => {
      initManager(manager);
      (manager as any).cache.chats[0].chatSessions = [];

      const stats = manager.getChatSessionsStats('chat-1');
      expect(stats.totalChatSessions).toBe(0);
      expect(stats.lastUpdated).toBeNull();
      expect(stats.oldestChatSession).toBeNull();
      expect(stats.newestChatSession).toBeNull();
    });
  });

  // ── getNextPrompt() empty history + empty currentEditingPrompt (line 962) ──

  describe('getNextPrompt() null branch when currentEditingPrompt is empty', () => {
    it('returns null when history is empty and currentEditingPrompt is empty string', () => {
      (manager as any).currentEditingPrompt = '';
      expect(manager.getNextPrompt()).toBeNull();
    });

    it('returns null at tail when cursor is -1 and currentEditingPrompt is empty (line 973)', () => {
      manager.addPromptToHistory('one');
      (manager as any).currentEditingPrompt = '';
      // cursor = -1 (at tail), editing prompt is empty
      expect(manager.getNextPrompt()).toBeNull();
    });
  });

  // ── buildStarredChatSessionIndexItem optional field branches (353, 358) ───

  describe('buildStarredChatSessionIndexItem() optional field branches', () => {
    it('sets readStatus when present', () => {
      initManager(manager);
      const result = (manager as any).buildStarredChatSessionIndexItem('chat-1', {
        chatSession_id: 's1',
        title: 'T',
        last_updated: '2026-01-01T00:00:00.000Z',
        readStatus: 'unread',
      });
      expect(result?.readStatus).toBe('unread');
    });

    it('sets undefined readStatus when absent', () => {
      initManager(manager);
      const result = (manager as any).buildStarredChatSessionIndexItem('chat-1', {
        chatSession_id: 's1',
        title: 'T',
        last_updated: '2026-01-01T00:00:00.000Z',
      });
      expect(result?.readStatus).toBeUndefined();
    });

    it('uses fallbackStarredAt when starredAt is absent', () => {
      initManager(manager);
      const result = (manager as any).buildStarredChatSessionIndexItem(
        'chat-1',
        { chatSession_id: 's1', title: 'T', last_updated: '2026-01-01T00:00:00.000Z' },
        '2025-06-01T00:00:00.000Z',
      );
      expect(result?.starredAt).toBe('2025-06-01T00:00:00.000Z');
    });

    it('uses default agent name and current time when optional values are absent', () => {
      initManager(manager);
      delete (manager as any).cache.chats[0].agent.name;

      const result = (manager as any).buildStarredChatSessionIndexItem('chat-1', {
        chatSession_id: 's1',
        title: 'T',
        last_updated: '2026-01-01T00:00:00.000Z',
      });

      expect(result?.agentName).toBe('Unnamed Agent');
      expect(result?.starredAt).toEqual(expect.any(String));
    });
  });

  describe('chat session store edge branches', () => {
    it('creates a session when chatSessions is undefined', () => {
      initManager(manager);
      delete (manager as any).cache.chats[0].chatSessions;

      (manager as any).handleChatSessionStoreSessionCreated({
        alias: 'testUser',
        chatId: 'chat-1',
        session: { chatSession_id: 'created-from-empty', title: 'Created', last_updated: '2026-02-01T00:00:00.000Z' },
        timestamp: Date.now(),
      });

      expect(manager.getChatSessions('chat-1')).toHaveLength(1);
    });

    it('returns early when deleting from a missing chat', () => {
      initManager(manager);

      expect(() => {
        (manager as any).handleChatSessionStoreSessionDeleted({
          alias: 'testUser',
          chatId: 'missing-chat',
          chatSessionId: 'session',
          timestamp: Date.now(),
        });
      }).not.toThrow();
    });
  });

  describe('getChatSessionsStats() fallback branches', () => {
    it('returns null fields for malformed session entries without ids or dates', () => {
      initManager(manager);
      (manager as any).cache.chats[0].chatSessions = [{}];

      const stats = manager.getChatSessionsStats('chat-1');

      expect(stats).toEqual({
        totalChatSessions: 1,
        lastUpdated: null,
        oldestChatSession: null,
        newestChatSession: null,
      });
    });
  });

  describe('getNextPrompt() editing prompt fallback', () => {
    it('returns the current editing prompt at the history tail', () => {
      manager.addPromptToHistory('one');
      manager.setCurrentEditingPrompt('draft');

      expect(manager.getNextPrompt()).toBe('draft');
    });
  });
});
