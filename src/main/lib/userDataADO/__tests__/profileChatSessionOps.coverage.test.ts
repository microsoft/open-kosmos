/**
 * profileChatSessionOps.coverage.test.ts
 */

const mockSaveSession = vi.hoisted(() => vi.fn());
const mockDeleteSession = vi.hoisted(() => vi.fn());
const mockGetChatSessionsProjection = vi.hoisted(() => vi.fn());
const mockEnsureLoaded = vi.hoisted(() => vi.fn());

vi.mock('../../chat/chatSessionStore', () => ({
  chatSessionStore: {
    saveSession: mockSaveSession,
    deleteSession: mockDeleteSession,
    getChatSessionsProjection: mockGetChatSessionsProjection,
    ensureLoaded: mockEnsureLoaded,
  },
}));

vi.mock('../../unifiedLogger', () => ({
  createConsoleLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

import {
  saveChatSession,
  deleteChatSession,
  getChatSessions,
  getChatSessionsAsync,
  getChatSessionFile,
} from '../profileChatSessionOps';

const makeCtx = () => ({
  syncStarredChatSessionIndex: vi.fn().mockResolvedValue(true),
  removeStarredChatSessionIndex: vi.fn().mockResolvedValue(true),
  notifyProfileDataManager: vi.fn().mockResolvedValue(undefined),
});

const chatSessionFile = {
  chatSession_id: 'sess-1',
  title: 'My chat',
  last_updated: '2024-01-01T00:00:00Z',
  messages: [],
} as any;

describe('saveChatSession', () => {
  it('saves session and returns true on success', async () => {
    const ctx = makeCtx();
    mockSaveSession.mockResolvedValue(true);

    const result = await saveChatSession(ctx, 'alice', 'chat-1', chatSessionFile);
    expect(result).toBe(true);
    expect(mockSaveSession).toHaveBeenCalledWith(
      'alice',
      'chat-1',
      expect.objectContaining({ chatSession_id: 'sess-1' }),
      chatSessionFile
    );
    expect(ctx.syncStarredChatSessionIndex).toHaveBeenCalledWith(
      'alice',
      'chat-1',
      expect.objectContaining({ chatSession_id: 'sess-1', title: 'My chat' }),
      { notifyRenderer: false }
    );
    expect(ctx.notifyProfileDataManager).toHaveBeenCalledWith('alice', true);
  });

  it('returns false when saveSession returns false', async () => {
    const ctx = makeCtx();
    mockSaveSession.mockResolvedValue(false);

    const result = await saveChatSession(ctx, 'alice', 'chat-1', chatSessionFile);
    expect(result).toBe(false);
    expect(ctx.syncStarredChatSessionIndex).not.toHaveBeenCalled();
  });

  it('returns false on exception', async () => {
    const ctx = makeCtx();
    mockSaveSession.mockRejectedValue(new Error('DB error'));

    const result = await saveChatSession(ctx, 'alice', 'chat-1', chatSessionFile);
    expect(result).toBe(false);
  });
});

describe('deleteChatSession', () => {
  it('deletes and returns true on success', async () => {
    const ctx = makeCtx();
    mockDeleteSession.mockResolvedValue(true);

    const result = await deleteChatSession(ctx, 'alice', 'chat-1', 'sess-1');
    expect(result).toBe(true);
    expect(mockDeleteSession).toHaveBeenCalledWith('alice', 'chat-1', 'sess-1');
    expect(ctx.removeStarredChatSessionIndex).toHaveBeenCalledWith('alice', 'sess-1', { notifyRenderer: false });
    expect(ctx.notifyProfileDataManager).toHaveBeenCalledWith('alice', true);
  });

  it('returns false when deleteSession returns false', async () => {
    const ctx = makeCtx();
    mockDeleteSession.mockResolvedValue(false);

    const result = await deleteChatSession(ctx, 'alice', 'chat-1', 'sess-1');
    expect(result).toBe(false);
    expect(ctx.removeStarredChatSessionIndex).not.toHaveBeenCalled();
  });

  it('returns false on exception', async () => {
    const ctx = makeCtx();
    mockDeleteSession.mockRejectedValue(new Error('DB crash'));

    const result = await deleteChatSession(ctx, 'alice', 'chat-1', 'sess-1');
    expect(result).toBe(false);
  });
});

describe('getChatSessions (deprecated)', () => {
  it('returns empty array', () => {
    const result = getChatSessions('alice', 'chat-1');
    expect(result).toEqual([]);
  });
});

describe('getChatSessionsAsync', () => {
  it('returns sessions from store', async () => {
    const sessions = [{ chatSession_id: 'sess-1', title: 'Chat 1', last_updated: '2024-01-01' }];
    mockGetChatSessionsProjection.mockResolvedValue({ sessions });

    const result = await getChatSessionsAsync('alice', 'chat-1');
    expect(result).toEqual(sessions);
    expect(mockGetChatSessionsProjection).toHaveBeenCalledWith('alice', 'chat-1');
  });

  it('returns empty array on error', async () => {
    mockGetChatSessionsProjection.mockRejectedValue(new Error('DB fail'));
    const result = await getChatSessionsAsync('alice', 'chat-1');
    expect(result).toEqual([]);
  });
});

describe('getChatSessionFile', () => {
  it('returns session file on success', async () => {
    const file = { chatSession_id: 'sess-1', messages: [] };
    mockEnsureLoaded.mockResolvedValue({ file });

    const result = await getChatSessionFile('alice', 'chat-1', 'sess-1');
    expect(result).toEqual(file);
    expect(mockEnsureLoaded).toHaveBeenCalledWith('alice', 'chat-1', 'sess-1');
  });

  it('returns null when ensureLoaded returns null', async () => {
    mockEnsureLoaded.mockResolvedValue(null);
    const result = await getChatSessionFile('alice', 'chat-1', 'sess-1');
    expect(result).toBeNull();
  });

  it('returns null when ensureLoaded returns entry without file', async () => {
    mockEnsureLoaded.mockResolvedValue({ file: undefined });
    const result = await getChatSessionFile('alice', 'chat-1', 'sess-1');
    expect(result).toBeNull();
  });

  it('returns null on error', async () => {
    mockEnsureLoaded.mockRejectedValue(new Error('load error'));
    const result = await getChatSessionFile('alice', 'chat-1', 'sess-1');
    expect(result).toBeNull();
  });
});
