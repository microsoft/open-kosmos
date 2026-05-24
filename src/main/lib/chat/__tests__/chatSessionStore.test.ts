const sharedMockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../unifiedLogger', () => ({
  createLogger: vi.fn(() => sharedMockLogger),
}));

vi.mock('electron', async () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
}));

const mockChatSessionManager = vi.hoisted(() => ({
  readMonthIndex: vi.fn(),
  getChatSessionFile: vi.fn(),
  persistNewChatSession: vi.fn().mockResolvedValue(true),
  persistUpdatedChatSession: vi.fn().mockResolvedValue(true),
  deleteChatSession: vi.fn().mockResolvedValue(true),
  getAllChatSessions: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../userDataADO/chatSessionManager', () => ({
  chatSessionManager: mockChatSessionManager,
}));

vi.mock('../../remoteChannel/agentBridge/attachmentPipeline', () => ({
  cleanupSessionAttachmentDir: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../userDataADO/pathUtils', () => ({
  isValidChatSessionId: vi.fn((id: string) => /^[a-zA-Z0-9_-]+-\d{4}-\d{2}$/.test(id) || id.startsWith('session-')),
  extractMonthFromChatSessionId: vi.fn((id: string) => {
    const match = id.match(/(\d{4}-\d{2})$/);
    return match ? match[1] : '2026-01';
  }),
}));

import { ChatSessionStore } from '../chatSessionStore';
import type { ChatSession } from '../../userDataADO/types/profile';
import type { ChatSessionFile } from '../../userDataADO/chatSessionFileOps';

function makeMetadata(overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    chatSession_id: 'session-2026-01',
    title: 'Test Session',
    last_updated: '2026-01-01T00:00:00.000Z',
    chat_history: [],
    context_history: [],
    interaction_history: [],
    readStatus: 'read',
    ...overrides,
  } as ChatSession;
}

function makeFile(overrides: Partial<ChatSessionFile> = {}): ChatSessionFile {
  return {
    chatSession_id: 'session-2026-01',
    title: 'Test Session',
    last_updated: '2026-01-01T00:00:00.000Z',
    chat_history: [],
    context_history: [],
    interaction_history: [],
    ...overrides,
  } as ChatSessionFile;
}

function createFreshStore(): ChatSessionStore {
  // Use private access to reset singleton for test isolation
  (ChatSessionStore as any).instance = undefined;
  return ChatSessionStore.getInstance();
}

describe('ChatSessionStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockChatSessionManager.persistNewChatSession.mockResolvedValue(true);
    mockChatSessionManager.persistUpdatedChatSession.mockResolvedValue(true);
    mockChatSessionManager.deleteChatSession.mockResolvedValue(true);
    mockChatSessionManager.getAllChatSessions.mockResolvedValue([]);
  });

  describe('getInstance', () => {
    it('returns the same instance', () => {
      const a = ChatSessionStore.getInstance();
      const b = ChatSessionStore.getInstance();
      expect(a).toBe(b);
    });
  });

  describe('createSession', () => {
    it('creates and caches a new session', async () => {
      const store = createFreshStore();
      const metadata = makeMetadata();
      const file = makeFile();

      const aggregate = await store.createSession('alice', 'chat-1', metadata, file);

      expect(aggregate.alias).toBe('alice');
      expect(aggregate.chatId).toBe('chat-1');
      expect(aggregate.metadata.chatSession_id).toBe('session-2026-01');
      expect(mockChatSessionManager.persistNewChatSession).toHaveBeenCalledOnce();
    });

    it('sets dirtyMetadata and dirtyFile after creation', async () => {
      const store = createFreshStore();
      const aggregate = await store.createSession('alice', 'chat-1', makeMetadata(), makeFile());
      // After flush succeeds, dirty flags should be cleared
      expect(aggregate.runtime.dirtyMetadata).toBe(false);
      expect(aggregate.runtime.dirtyFile).toBe(false);
    });

    it('caches the created session so getSession returns it', async () => {
      const store = createFreshStore();
      await store.createSession('alice', 'chat-1', makeMetadata(), makeFile());
      const found = store.getSession('session-2026-01');
      expect(found).not.toBeNull();
      expect(found!.chatId).toBe('chat-1');
    });

    it('normalizes readStatus unread to unread', async () => {
      const store = createFreshStore();
      const metadata = makeMetadata({ readStatus: 'unread' });
      const aggregate = await store.createSession('alice', 'chat-1', metadata, makeFile());
      expect(aggregate.metadata.readStatus).toBe('unread');
    });

    it('normalizes unknown readStatus to read', async () => {
      const store = createFreshStore();
      const metadata = makeMetadata({ readStatus: undefined });
      const aggregate = await store.createSession('alice', 'chat-1', metadata, makeFile());
      expect(aggregate.metadata.readStatus).toBe('read');
    });
  });

  describe('getSession / getSessionFile / getSessionMetadata', () => {
    it('returns null for uncached session', () => {
      const store = createFreshStore();
      expect(store.getSession('nonexistent')).toBeNull();
    });

    it('getSessionFile returns a snapshot', async () => {
      const store = createFreshStore();
      await store.createSession('alice', 'chat-1', makeMetadata(), makeFile());
      const file = store.getSessionFile('session-2026-01');
      expect(file).not.toBeNull();
      expect(file!.chatSession_id).toBe('session-2026-01');
    });

    it('getSessionMetadata returns a snapshot', async () => {
      const store = createFreshStore();
      await store.createSession('alice', 'chat-1', makeMetadata(), makeFile());
      const meta = store.getSessionMetadata('session-2026-01');
      expect(meta).not.toBeNull();
      expect(meta!.title).toBe('Test Session');
    });
  });

  describe('saveSession', () => {
    it('creates when session does not exist', async () => {
      const store = createFreshStore();
      mockChatSessionManager.readMonthIndex.mockResolvedValue(null);

      const result = await store.saveSession('alice', 'chat-1', makeMetadata(), makeFile());
      expect(result).not.toBeNull();
      expect(mockChatSessionManager.persistNewChatSession).toHaveBeenCalledOnce();
    });

    it('updates when session already cached', async () => {
      const store = createFreshStore();
      await store.createSession('alice', 'chat-1', makeMetadata(), makeFile());
      vi.clearAllMocks();
      mockChatSessionManager.persistUpdatedChatSession.mockResolvedValue(true);
      mockChatSessionManager.getAllChatSessions.mockResolvedValue([makeMetadata()]);

      const updated = makeMetadata({ title: 'Updated Title' });
      const result = await store.saveSession('alice', 'chat-1', updated, makeFile({ title: 'Updated Title' }));
      expect(result).not.toBeNull();
      expect(result!.metadata.title).toBe('Updated Title');
      expect(mockChatSessionManager.persistUpdatedChatSession).toHaveBeenCalledOnce();
    });
  });

  describe('patchMetadata', () => {
    it('returns null when session not cached/loadable', async () => {
      const store = createFreshStore();
      mockChatSessionManager.readMonthIndex.mockResolvedValue(null);

      const result = await store.patchMetadata('alice', 'chat-1', 'session-2026-01', { title: 'New' });
      expect(result).toBeNull();
    });

    it('patches metadata on cached session', async () => {
      const store = createFreshStore();
      await store.createSession('alice', 'chat-1', makeMetadata(), makeFile());
      mockChatSessionManager.persistUpdatedChatSession.mockResolvedValue(true);
      mockChatSessionManager.getAllChatSessions.mockResolvedValue([makeMetadata()]);

      const result = await store.patchMetadata('alice', 'chat-1', 'session-2026-01', { title: 'Patched' });
      expect(result).not.toBeNull();
      expect(result!.metadata.title).toBe('Patched');
    });
  });

  describe('setReadStatus', () => {
    it('no-ops when status unchanged', async () => {
      const store = createFreshStore();
      await store.createSession('alice', 'chat-1', makeMetadata({ readStatus: 'read' }), makeFile());
      vi.clearAllMocks();

      const result = await store.setReadStatus('alice', 'chat-1', 'session-2026-01', 'read');
      expect(result).not.toBeNull();
      expect(mockChatSessionManager.persistUpdatedChatSession).not.toHaveBeenCalled();
    });

    it('persists when status changes', async () => {
      const store = createFreshStore();
      await store.createSession('alice', 'chat-1', makeMetadata({ readStatus: 'read' }), makeFile());
      vi.clearAllMocks();
      mockChatSessionManager.persistUpdatedChatSession.mockResolvedValue(true);
      mockChatSessionManager.getAllChatSessions.mockResolvedValue([makeMetadata({ readStatus: 'unread' })]);

      const result = await store.setReadStatus('alice', 'chat-1', 'session-2026-01', 'unread');
      expect(result).not.toBeNull();
      expect(result!.metadata.readStatus).toBe('unread');
      expect(mockChatSessionManager.persistUpdatedChatSession).toHaveBeenCalledOnce();
    });
  });

  describe('setStarred', () => {
    it('no-ops when starred state unchanged', async () => {
      const store = createFreshStore();
      await store.createSession('alice', 'chat-1', makeMetadata({ starred: false }), makeFile());
      vi.clearAllMocks();

      const result = await store.setStarred('alice', 'chat-1', 'session-2026-01', false);
      expect(result).not.toBeNull();
      expect(mockChatSessionManager.persistUpdatedChatSession).not.toHaveBeenCalled();
    });

    it('persists when starred changes', async () => {
      const store = createFreshStore();
      await store.createSession('alice', 'chat-1', makeMetadata({ starred: false }), makeFile());
      vi.clearAllMocks();
      mockChatSessionManager.persistUpdatedChatSession.mockResolvedValue(true);

      const result = await store.setStarred('alice', 'chat-1', 'session-2026-01', true);
      expect(result).not.toBeNull();
      expect(result!.metadata.starred).toBe(true);
      expect(result!.metadata.starredAt).toBeDefined();
    });
  });

  describe('renameSession', () => {
    it('updates title in metadata and file', async () => {
      const store = createFreshStore();
      await store.createSession('alice', 'chat-1', makeMetadata(), makeFile());
      mockChatSessionManager.persistUpdatedChatSession.mockResolvedValue(true);
      mockChatSessionManager.getAllChatSessions.mockResolvedValue([makeMetadata({ title: 'Renamed' })]);

      const result = await store.renameSession('alice', 'chat-1', 'session-2026-01', 'Renamed');
      expect(result).not.toBeNull();
      expect(result!.metadata.title).toBe('Renamed');
      expect(result!.file.title).toBe('Renamed');
    });
  });

  describe('deleteSession', () => {
    it('removes session from cache and returns true', async () => {
      const store = createFreshStore();
      await store.createSession('alice', 'chat-1', makeMetadata(), makeFile());
      mockChatSessionManager.getAllChatSessions.mockResolvedValue([]);

      const deleted = await store.deleteSession('alice', 'chat-1', 'session-2026-01');
      expect(deleted).toBe(true);
      expect(store.getSession('session-2026-01')).toBeNull();
    });

    it('returns false when underlying delete fails', async () => {
      const store = createFreshStore();
      await store.createSession('alice', 'chat-1', makeMetadata(), makeFile());
      mockChatSessionManager.deleteChatSession.mockResolvedValue(false);
      mockChatSessionManager.getAllChatSessions.mockResolvedValue([]);

      const deleted = await store.deleteSession('alice', 'chat-1', 'session-2026-01');
      expect(deleted).toBe(false);
      // Session should still be in cache since delete failed
      expect(store.getSession('session-2026-01')).not.toBeNull();
    });
  });

  describe('getChatSessionsProjection', () => {
    it('merges in-memory overlays over persisted data', async () => {
      const store = createFreshStore();
      const persisted = makeMetadata({ chatSession_id: 'other-2026-01', title: 'Old' });
      mockChatSessionManager.getAllChatSessions.mockResolvedValue([persisted]);

      // Cache a different session
      await store.createSession('alice', 'chat-1', makeMetadata(), makeFile());
      mockChatSessionManager.getAllChatSessions.mockResolvedValue([persisted]);

      const projection = await store.getChatSessionsProjection('alice', 'chat-1');
      expect(projection.alias).toBe('alice');
      expect(projection.chatId).toBe('chat-1');
      // Should contain both the persisted (other-*) and in-memory (session-*)
      const ids = projection.sessions.map((s) => s.chatSession_id);
      expect(ids).toContain('session-2026-01');
    });
  });

  describe('getUnreadSummary', () => {
    it('counts unread user sessions', async () => {
      const store = createFreshStore();
      const unread = makeMetadata({ readStatus: 'unread' });
      mockChatSessionManager.getAllChatSessions.mockResolvedValue([unread]);

      const summary = await store.getUnreadSummary('alice', 'chat-1');
      expect(summary.userUnreadCount).toBe(1);
      expect(summary.scheduledUnreadCount).toBe(0);
    });

    it('counts recent scheduled unread sessions', async () => {
      const store = createFreshStore();
      const recentScheduled = makeMetadata({
        readStatus: 'unread',
        schedulerJobId: 'job-1',
        schedulerCompletedAt: new Date().toISOString(),
      });
      mockChatSessionManager.getAllChatSessions.mockResolvedValue([recentScheduled]);

      const summary = await store.getUnreadSummary('alice', 'chat-1');
      expect(summary.scheduledUnreadCount).toBe(1);
      expect(summary.userUnreadCount).toBe(0);
    });

    it('does not count old scheduled sessions', async () => {
      const store = createFreshStore();
      const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
      const oldScheduled = makeMetadata({
        readStatus: 'unread',
        schedulerJobId: 'job-1',
        schedulerCompletedAt: oldDate,
      });
      mockChatSessionManager.getAllChatSessions.mockResolvedValue([oldScheduled]);

      const summary = await store.getUnreadSummary('alice', 'chat-1');
      expect(summary.scheduledUnreadCount).toBe(0);
    });
  });

  describe('markAllSessionsAsRead', () => {
    it('marks all unread sessions as read', async () => {
      const store = createFreshStore();
      const unread1 = makeMetadata({ chatSession_id: 'session-2026-01', readStatus: 'unread' });
      const unread2 = makeMetadata({ chatSession_id: 'session-2026-02', readStatus: 'unread' });
      mockChatSessionManager.getAllChatSessions.mockResolvedValue([unread1, unread2]);
      mockChatSessionManager.readMonthIndex.mockResolvedValue({ sessions: [unread1] });
      mockChatSessionManager.getChatSessionFile.mockResolvedValue(makeFile());
      mockChatSessionManager.persistUpdatedChatSession.mockResolvedValue(true);

      // Pre-cache session 1 only to avoid loadMonthIndex for session 2
      await store.createSession('alice', 'chat-1', unread1, makeFile());
      vi.clearAllMocks();
      mockChatSessionManager.getAllChatSessions.mockResolvedValue([unread1, unread2]);
      mockChatSessionManager.readMonthIndex.mockResolvedValue({
        sessions: [unread2],
      });
      mockChatSessionManager.getChatSessionFile.mockResolvedValue(makeFile({ chatSession_id: 'session-2026-02' }));
      mockChatSessionManager.persistUpdatedChatSession.mockResolvedValue(true);

      const count = await store.markAllSessionsAsRead('alice', 'chat-1');
      expect(count).toBeGreaterThanOrEqual(1);
    });
  });

  describe('patchSchedulerMetadata', () => {
    it('patches scheduler fields', async () => {
      const store = createFreshStore();
      await store.createSession('alice', 'chat-1', makeMetadata(), makeFile());
      mockChatSessionManager.persistUpdatedChatSession.mockResolvedValue(true);
      mockChatSessionManager.getAllChatSessions.mockResolvedValue([makeMetadata()]);

      const result = await store.patchSchedulerMetadata('alice', 'chat-1', 'session-2026-01', {
        schedulerJobId: 'job-99',
        schedulerExecutionStatus: 'running',
      });
      expect(result).not.toBeNull();
      expect(result!.metadata.schedulerJobId).toBe('job-99');
    });

    it('no-ops when no fields changed', async () => {
      const store = createFreshStore();
      await store.createSession(
        'alice',
        'chat-1',
        makeMetadata({ schedulerJobId: 'job-1', schedulerExecutionStatus: 'completed' }),
        makeFile()
      );
      vi.clearAllMocks();

      const result = await store.patchSchedulerMetadata('alice', 'chat-1', 'session-2026-01', {
        schedulerJobId: 'job-1',
        schedulerExecutionStatus: 'completed',
      });
      expect(result).not.toBeNull();
      expect(mockChatSessionManager.persistUpdatedChatSession).not.toHaveBeenCalled();
    });
  });

  describe('copySession', () => {
    it('returns false when source session not found', async () => {
      const store = createFreshStore();
      mockChatSessionManager.readMonthIndex.mockResolvedValue(null);

      const result = await store.copySession('alice', 'chat-1', 'session-2026-01', 'session-2026-02');
      expect(result).toBe(false);
    });

    it('creates a fork with modified title', async () => {
      const store = createFreshStore();
      await store.createSession('alice', 'chat-1', makeMetadata({ title: 'Original' }), makeFile());
      mockChatSessionManager.persistNewChatSession.mockResolvedValue(true);
      mockChatSessionManager.getAllChatSessions.mockResolvedValue([]);

      const result = await store.copySession('alice', 'chat-1', 'session-2026-01', 'fork-2026-01');
      expect(result).toBe(true);

      const forked = store.getSession('fork-2026-01');
      expect(forked).not.toBeNull();
      expect(forked!.metadata.title).toContain('Fork');
      expect(forked!.metadata.readStatus).toBe('unread');
    });
  });
});
