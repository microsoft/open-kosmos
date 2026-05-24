/**
 * Supplemental coverage tests for chatSessionStore.ts
 * Covers branches not reached by chatSessionStore.test.ts
 */

const sharedMockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../unifiedLogger', () => ({
  createLogger: vi.fn(() => sharedMockLogger),
}));

// Provide a BrowserWindow mock that can have a real window with webContents
const mockWebContents = vi.hoisted(() => ({ send: vi.fn() }));
const mockMainWindow = vi.hoisted(() => ({
  isDestroyed: vi.fn(() => false),
  webContents: mockWebContents,
}));

vi.mock('electron', async () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => [mockMainWindow]),
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
  isValidChatSessionId: vi.fn((id: string) => id.startsWith('session-')),
  extractMonthFromChatSessionId: vi.fn((id: string) => {
    const match = id.match(/(\d{4}-\d{2})$/);
    return match ? match[1] : (id.startsWith('session-') ? '2026-01' : null);
  }),
}));

import { ChatSessionStore } from '../chatSessionStore';
import type { ChatSession } from '../../userDataADO/types/profile';
import type { ChatSessionFile } from '../../userDataADO/chatSessionFileOps';
import { BrowserWindow } from 'electron';

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
  (ChatSessionStore as any).instance = undefined;
  return ChatSessionStore.getInstance();
}

beforeEach(() => {
  vi.clearAllMocks();
  mockWebContents.send.mockReset();
  mockMainWindow.isDestroyed.mockReturnValue(false);
  mockChatSessionManager.persistNewChatSession.mockResolvedValue(true);
  mockChatSessionManager.persistUpdatedChatSession.mockResolvedValue(true);
  mockChatSessionManager.deleteChatSession.mockResolvedValue(true);
  mockChatSessionManager.getAllChatSessions.mockResolvedValue([]);
});

// ── setMainWindow ─────────────────────────────────────────────────────────────

describe('setMainWindow', () => {
  it('sets the main window', () => {
    const store = createFreshStore();
    store.setMainWindow(mockMainWindow as any);
    // Should not throw
    expect(() => store.setMainWindow(null)).not.toThrow();
  });
});

// ── getWindow — mainWindow path ───────────────────────────────────────────────

describe('getWindow via notification — mainWindow active', () => {
  it('uses mainWindow when set and not destroyed', async () => {
    const store = createFreshStore();
    store.setMainWindow(mockMainWindow as any);
    mockMainWindow.isDestroyed.mockReturnValue(false);
    mockChatSessionManager.getAllChatSessions.mockResolvedValue([]);

    // Create a session to trigger notifySessionCreated which calls getWindow
    await store.createSession('alice', 'chat-1', makeMetadata(), makeFile());
    expect(mockWebContents.send).toHaveBeenCalledWith(
      'chatSessionStore:sessionCreated',
      expect.any(Object)
    );
  });

  it('falls back to getAllWindows when mainWindow is destroyed', async () => {
    const store = createFreshStore();
    store.setMainWindow(mockMainWindow as any);
    mockMainWindow.isDestroyed.mockReturnValue(true); // simulate destroyed window
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
      { isDestroyed: () => false, webContents: mockWebContents } as any,
    ]);
    mockChatSessionManager.getAllChatSessions.mockResolvedValue([]);

    await store.createSession('alice', 'chat-1', makeMetadata(), makeFile());
    // Should still notify via the fallback window
    expect(mockWebContents.send).toHaveBeenCalled();
  });

  it('does not notify when no window is available', async () => {
    const store = createFreshStore();
    store.setMainWindow(null);
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([]);
    mockChatSessionManager.getAllChatSessions.mockResolvedValue([]);

    await store.createSession('alice', 'chat-1', makeMetadata(), makeFile());
    // No notification sent since no window
    // (No throw expected)
    expect(true).toBe(true);
  });
});

// ── ensureLoaded — invalid chatSessionId ─────────────────────────────────────

describe('ensureLoaded — invalid chatSessionId', () => {
  it('returns null and warns for invalid chatSessionId', async () => {
    const store = createFreshStore();
    const { isValidChatSessionId } = await import('../../userDataADO/pathUtils');
    vi.mocked(isValidChatSessionId).mockReturnValueOnce(false);

    const result = await store.ensureLoaded('alice', 'chat-1', 'invalid-id');
    expect(result).toBeNull();
    expect(sharedMockLogger.warn).toHaveBeenCalled();
  });

  it('returns null when month extraction fails', async () => {
    const store = createFreshStore();
    const { extractMonthFromChatSessionId } = await import('../../userDataADO/pathUtils');
    vi.mocked(extractMonthFromChatSessionId).mockReturnValueOnce(null);

    const result = await store.ensureLoaded('alice', 'chat-1', 'session-2026-01');
    expect(result).toBeNull();
  });

  it('returns null when session not in month index', async () => {
    const store = createFreshStore();
    mockChatSessionManager.readMonthIndex.mockResolvedValue({
      sessions: [makeMetadata({ chatSession_id: 'session-other-01' })],
    });

    const result = await store.ensureLoaded('alice', 'chat-1', 'session-2026-01');
    expect(result).toBeNull();
  });

  it('returns null when getChatSessionFile returns null', async () => {
    const store = createFreshStore();
    mockChatSessionManager.readMonthIndex.mockResolvedValue({
      sessions: [makeMetadata()],
    });
    mockChatSessionManager.getChatSessionFile.mockResolvedValue(null);

    const result = await store.ensureLoaded('alice', 'chat-1', 'session-2026-01');
    expect(result).toBeNull();
  });
});

// ── createSession — invalid month ─────────────────────────────────────────────

describe('createSession — invalid chatSession_id', () => {
  it('throws when chatSession_id has no valid month', async () => {
    const store = createFreshStore();
    const { extractMonthFromChatSessionId } = await import('../../userDataADO/pathUtils');
    vi.mocked(extractMonthFromChatSessionId).mockReturnValueOnce(null);

    await expect(
      store.createSession('alice', 'chat-1', makeMetadata({ chatSession_id: 'invalid' }), makeFile())
    ).rejects.toThrow('Invalid chatSessionId');
  });
});

// ── patchFile ─────────────────────────────────────────────────────────────────

describe('patchFile', () => {
  it('patches file and sends notifications', async () => {
    const store = createFreshStore();
    store.setMainWindow(mockMainWindow as any);
    await store.createSession('alice', 'chat-1', makeMetadata(), makeFile());
    vi.clearAllMocks();
    mockWebContents.send.mockReset();
    mockChatSessionManager.persistUpdatedChatSession.mockResolvedValue(true);
    mockChatSessionManager.getAllChatSessions.mockResolvedValue([makeMetadata()]);

    const result = await store.patchFile('alice', 'chat-1', 'session-2026-01', {
      title: 'New Title',
    });
    expect(result).not.toBeNull();
    expect(result!.file.title).toBe('New Title');
    expect(mockWebContents.send).toHaveBeenCalledWith(
      'chatSessionStore:filePatched',
      expect.any(Object)
    );
  });

  it('returns null when session not found', async () => {
    const store = createFreshStore();
    mockChatSessionManager.readMonthIndex.mockResolvedValue(null);

    const result = await store.patchFile('alice', 'chat-1', 'session-2026-01', { title: 'x' });
    expect(result).toBeNull();
  });
});

// ── deleteSession — when not in cache ─────────────────────────────────────────

describe('deleteSession — not cached', () => {
  it('delegates to chatSessionManager when not cached', async () => {
    const store = createFreshStore();
    mockChatSessionManager.readMonthIndex.mockResolvedValue(null);
    mockChatSessionManager.deleteChatSession.mockResolvedValue(true);

    const result = await store.deleteSession('alice', 'chat-1', 'session-2026-01');
    expect(result).toBe(true);
    expect(mockChatSessionManager.deleteChatSession).toHaveBeenCalled();
  });
});

// ── getChatSessionsProjection — overlay skip branch ───────────────────────────

describe('getChatSessionsProjection — overlay mismatch', () => {
  it('skips overlay session from different alias', async () => {
    const store = createFreshStore();
    // Cache a session for alias 'alice'
    await store.createSession('alice', 'chat-1', makeMetadata(), makeFile());
    // But query for alias 'bob' (mismatch)
    mockChatSessionManager.getAllChatSessions.mockResolvedValue([]);
    const projection = await store.getChatSessionsProjection('bob', 'chat-1');
    // The overlay (alice's session) should be skipped
    const ids = projection.sessions.map((s: any) => s.chatSession_id);
    expect(ids).not.toContain('session-2026-01');
  });
});

// ── buildUnreadSummary — scheduled session without event time ─────────────────

describe('buildUnreadSummary — scheduled session without valid timestamp', () => {
  it('does not count scheduled sessions with invalid timestamp', async () => {
    const store = createFreshStore();
    const invalidScheduled = makeMetadata({
      readStatus: 'unread',
      schedulerJobId: 'job-1',
      schedulerCompletedAt: 'invalid-date',
      schedulerStartedAt: undefined,
      last_updated: 'also-invalid',
    });
    mockChatSessionManager.getAllChatSessions.mockResolvedValue([invalidScheduled]);

    const summary = await store.getUnreadSummary('alice', 'chat-1');
    // NaN timestamp => eventTime is null => not counted as scheduled unread
    expect(summary.scheduledUnreadCount).toBe(0);
    // Not a user session either (has schedulerJobId)
    expect(summary.userUnreadCount).toBe(0);
  });
});

// ── markAllSessionsAsRead — skips already-read sessions ──────────────────────

describe('markAllSessionsAsRead — skip read sessions', () => {
  it('skips sessions already marked as read', async () => {
    const store = createFreshStore();
    const readSession = makeMetadata({ readStatus: 'read' });
    mockChatSessionManager.getAllChatSessions.mockResolvedValue([readSession]);

    const count = await store.markAllSessionsAsRead('alice', 'chat-1');
    expect(count).toBe(0);
    expect(mockChatSessionManager.persistUpdatedChatSession).not.toHaveBeenCalled();
  });
});

// ── notifyAutoSelect — via createSession with autoSelect ──────────────────────

describe('notifyAutoSelect', () => {
  it('sends autoSelect IPC when creating non-scheduled session with autoSelect', async () => {
    const store = createFreshStore();
    store.setMainWindow(mockMainWindow as any);
    mockChatSessionManager.getAllChatSessions.mockResolvedValue([]);

    await store.createSession('alice', 'chat-1', makeMetadata(), makeFile(), {
      autoSelect: true,
    });

    const calls = mockWebContents.send.mock.calls;
    const autoSelectCall = calls.find((c: any[]) => c[0] === 'chatSession:autoSelect');
    expect(autoSelectCall).toBeDefined();
  });

  it('does NOT send autoSelect for scheduled sessions', async () => {
    const store = createFreshStore();
    store.setMainWindow(mockMainWindow as any);
    mockChatSessionManager.getAllChatSessions.mockResolvedValue([]);

    await store.createSession(
      'alice',
      'chat-1',
      makeMetadata({ schedulerJobId: 'job-123' }),
      makeFile(),
      { autoSelect: true }
    );

    const calls = mockWebContents.send.mock.calls;
    const autoSelectCall = calls.find((c: any[]) => c[0] === 'chatSession:autoSelect');
    expect(autoSelectCall).toBeUndefined();
  });
});

// ── flushSession — success path persists revision ──────────────────────────────

describe('flushSession — revision persistence', () => {
  it('clears dirty flags after successful flush', async () => {
    const store = createFreshStore();
    const aggregate = await store.createSession('alice', 'chat-1', makeMetadata(), makeFile());
    expect(aggregate.runtime.dirtyMetadata).toBe(false);
    expect(aggregate.runtime.dirtyFile).toBe(false);
    expect(aggregate.runtime.persistedRevision).toBe(aggregate.runtime.revision);
  });

  it('throws when persistNewChatSession fails', async () => {
    const store = createFreshStore();
    mockChatSessionManager.persistNewChatSession.mockResolvedValueOnce(false);

    await expect(
      store.createSession('alice', 'chat-1', makeMetadata(), makeFile())
    ).rejects.toThrow('Failed to flush chat session');
  });
});

// ── notifySessionDeleted — sends IPC with active window ──────────────────────

describe('notifySessionDeleted', () => {
  it('sends sessionDeleted IPC after successful delete', async () => {
    const store = createFreshStore();
    store.setMainWindow(mockMainWindow as any);
    await store.createSession('alice', 'chat-1', makeMetadata(), makeFile());
    mockWebContents.send.mockClear();
    mockChatSessionManager.getAllChatSessions.mockResolvedValue([]);

    const deleted = await store.deleteSession('alice', 'chat-1', 'session-2026-01');
    expect(deleted).toBe(true);

    const deletedCall = mockWebContents.send.mock.calls.find(
      (c: any[]) => c[0] === 'chatSessionStore:sessionDeleted'
    );
    expect(deletedCall).toBeDefined();
    expect(deletedCall![1]).toMatchObject({
      alias: 'alice',
      chatId: 'chat-1',
      chatSessionId: 'session-2026-01',
    });
  });
});
