/**
 * @vitest-environment happy-dom
 */

const profileEventMocks = {
  onCacheUpdated: vi.fn(),
  onAutoSelectChatSession: vi.fn(),
  onChatSessionStoreSessionCreated: vi.fn(),
  onChatSessionStoreMetadataPatched: vi.fn(),
  onChatSessionStoreSessionDeleted: vi.fn(),
};

(window as any).electronAPI = {
  profile: profileEventMocks,
  mcp: {
    onServerStatesUpdated: vi.fn(() => vi.fn()),
  },
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
};

import { ProfileDataManager } from '../profileDataManager';
import type { ProfileV2 } from '../../../../main/lib/userDataADO/types/profile';

function createProfile(): ProfileV2 {
  return {
    version: '2.0.0',
    createdAt: '2026-03-20T00:00:00.000Z',
    updatedAt: '2026-03-20T00:00:00.000Z',
    alias: 'testUser',
    freDone: true,
    primaryAgent: 'Agent One',
    chats: [
      {
        chat_id: 'chat-1',
        chat_type: 'single_agent',
        agent: {
          name: 'Agent One',
          role: 'assistant',
          emoji: '🤖',
          avatar: '',
          version: '1.0.0',
          source: 'ON-DEVICE',
          workspace: '',
          mcp_servers: [],
          skills: [],
        },
      },
    ],
    skills: [],
    sub_agents: [],
    mcp_servers: [],
    'starred-chat-sessions': [],
  } as unknown as ProfileV2;
}

describe('ProfileDataManager starred session sync', () => {
  let manager: ProfileDataManager;

  beforeEach(() => {
    vi.clearAllMocks();
    (ProfileDataManager as any).instance = null;
    manager = ProfileDataManager.getInstance();
    (manager as any).userAlias = 'testUser';
    (manager as any).cache.isInitialized = true;
    (manager as any).cache.profile = null;
    (manager as any).cache.chats = [];
  });

  afterEach(() => {
    (ProfileDataManager as any).instance = null;
  });

  it('hydrates starred-chat-sessions from profile cache update', () => {
    const profile = createProfile();
    profile['starred-chat-sessions'] = [
      {
        chatId: 'chat-1',
        chatSessionId: 'session-1',
        title: 'Important Session',
        lastUpdated: '2026-03-20T10:00:00.000Z',
        readStatus: 'unread',
        source: { type: 'local' },
        agentName: 'Agent One',
        agentEmoji: '🤖',
        agentAvatar: '',
        agentSource: 'ON-DEVICE',
        agentVersion: '1.0.0',
        starredAt: '2026-03-20T09:00:00.000Z',
      },
    ];

    (manager as any).handleProfileCacheUpdate({
      alias: 'testUser',
      profile,
      timestamp: Date.now(),
    });

    expect(manager.getCache().profile?.['starred-chat-sessions']).toHaveLength(1);
  });

  it('updates starred index on metadata patch for starred session', () => {
    const profile = createProfile();
    (manager as any).handleProfileCacheUpdate({
      alias: 'testUser',
      profile,
      timestamp: Date.now(),
    });

    (manager as any).handleChatSessionStoreMetadataPatched({
      alias: 'testUser',
      chatId: 'chat-1',
      chatSessionId: 'session-1',
      metadata: {
        chatSession_id: 'session-1',
        title: 'Important Session',
        last_updated: '2026-03-20T10:00:00.000Z',
        readStatus: 'unread',
        starred: true,
        starredAt: '2026-03-20T09:00:00.000Z',
        source: { type: 'local' },
      },
      timestamp: Date.now(),
    });

    const items = manager.getCache().profile?.['starred-chat-sessions'] || [];
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual(expect.objectContaining({
      chatId: 'chat-1',
      chatSessionId: 'session-1',
      title: 'Important Session',
      agentName: 'Agent One',
    }));
  });

  it('removes starred index entry on session deletion', () => {
    const profile = createProfile();
    profile['starred-chat-sessions'] = [
      {
        chatId: 'chat-1',
        chatSessionId: 'session-1',
        title: 'Important Session',
        lastUpdated: '2026-03-20T10:00:00.000Z',
        readStatus: 'unread',
        source: { type: 'local' },
        agentName: 'Agent One',
        agentEmoji: '🤖',
        agentAvatar: '',
        agentSource: 'ON-DEVICE',
        agentVersion: '1.0.0',
        starredAt: '2026-03-20T09:00:00.000Z',
      },
    ];

    (manager as any).handleProfileCacheUpdate({
      alias: 'testUser',
      profile,
      timestamp: Date.now(),
    });

    (manager as any).handleChatSessionStoreSessionDeleted({
      alias: 'testUser',
      chatId: 'chat-1',
      chatSessionId: 'session-1',
      timestamp: Date.now(),
    });

    expect(manager.getCache().profile?.['starred-chat-sessions']).toEqual([]);
  });
});