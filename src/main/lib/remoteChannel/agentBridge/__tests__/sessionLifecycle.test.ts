vi.mock('@shared/constants/branding', async () => ({
  BRAND_NAME: 'openkosmos',
}));

vi.mock('../../../unifiedLogger', async () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock('../../../userDataADO/profileCacheManager', async () => ({
  profileCacheManager: {
    getCachedProfile: vi.fn(),
    forceNotifyProfileDataManager: vi.fn(),
    syncStarredChatSessionIndex: vi.fn().mockResolvedValue(false),
  },
}));

vi.mock('../../../chat/chatSessionStore', async () => ({
  chatSessionStore: {
    patchMetadata: vi.fn(),
    renameSession: vi.fn(),
    ensureLoaded: vi.fn(),
    getAllSessions: vi.fn(),
    createSession: vi.fn(),
  },
}));

const updateSessionTitleMock = vi.fn();

vi.mock('../../../chat/agentChatManager', async () => ({
  AgentChatManager: {
    getInstance: vi.fn(() => ({
      updateSessionTitle: updateSessionTitleMock,
    })),
  },
}));

import { profileCacheManager } from '../../../userDataADO/profileCacheManager';
import { chatSessionStore } from '../../../chat/chatSessionStore';
import { demoteSession, markSessionAsRemote, updateRemoteSessionTitle } from '../sessionLifecycle';

describe('sessionLifecycle starred index sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateSessionTitleMock.mockReset();
    updateSessionTitleMock.mockReturnValue(true);
  });

  it('syncs starred index when a remote session is marked as remote', async () => {
    (chatSessionStore.patchMetadata as Mock).mockResolvedValue({
      metadata: {
        chatSession_id: 'session-1',
        title: 'Remote Session',
        last_updated: '2026-03-20T10:00:00.000Z',
        source: { type: 'remote', channel: 'teams' },
        starred: true,
      },
    });

    await markSessionAsRemote('testUser', 'chat-1', 'session-1', 'teams');

    expect(profileCacheManager.syncStarredChatSessionIndex).toHaveBeenCalledWith(
      'testUser',
      'chat-1',
      expect.objectContaining({
        chatSession_id: 'session-1',
        source: { type: 'remote', channel: 'teams' },
      }),
      { notifyRenderer: true },
    );
  });

  it('syncs starred index when a remote session title is updated', async () => {
    (chatSessionStore.ensureLoaded as Mock).mockResolvedValue({
      file: { title: '[Remote] New conversation' },
    });
    (chatSessionStore.renameSession as Mock).mockResolvedValue({
      metadata: {
        chatSession_id: 'session-1',
        title: '[Remote] hello world',
        last_updated: '2026-03-20T10:00:00.000Z',
        starred: true,
      },
    });

    await updateRemoteSessionTitle('testUser', 'chat-1', 'session-1', 'hello world');

    expect(updateSessionTitleMock).toHaveBeenCalledWith('session-1', '[Remote] hello world');

    expect(profileCacheManager.syncStarredChatSessionIndex).toHaveBeenCalledWith(
      'testUser',
      'chat-1',
      expect.objectContaining({
        chatSession_id: 'session-1',
        title: '[Remote] hello world',
      }),
      { notifyRenderer: true },
    );
  });

  it('syncs starred index when a remote session is demoted to local', async () => {
    (chatSessionStore.patchMetadata as Mock).mockResolvedValue({
      metadata: {
        chatSession_id: 'session-1',
        title: 'Remote Session',
        last_updated: '2026-03-20T10:00:00.000Z',
        source: null,
        starred: true,
      },
    });

    await demoteSession('testUser', 'chat-1', 'session-1');

    expect(profileCacheManager.syncStarredChatSessionIndex).toHaveBeenCalledWith(
      'testUser',
      'chat-1',
      expect.objectContaining({
        chatSession_id: 'session-1',
        source: null,
      }),
      { notifyRenderer: true },
    );
  });
});