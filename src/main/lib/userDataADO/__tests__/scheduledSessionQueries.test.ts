import { describe, it, expect, vi } from 'vitest';
import {
  collectScheduledSessionPage,
  queryScheduledSessionPage,
  type ScheduledSessionPageOptions,
} from '../scheduledSessionQueries';
import type { ChatSession } from '../types/profile';

function makeSession(overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    chatSession_id: 'session-1',
    title: 'Test Session',
    last_updated: '2026-01-15T10:00:00Z',
    schedulerJobId: 'job-123',
    ...overrides,
  } as ChatSession;
}

describe('collectScheduledSessionPage', () => {
  it('returns empty result when no months', async () => {
    const result = await collectScheduledSessionPage(
      [],
      vi.fn(),
      () => true,
    );
    expect(result).toEqual({ sessions: [], total: 0, hasMore: false });
  });

  it('returns empty result when readMonthIndex returns null for all months', async () => {
    const readMonthIndex = vi.fn().mockResolvedValue(null);
    const result = await collectScheduledSessionPage(
      ['202601', '202602'],
      readMonthIndex,
      () => true,
    );
    expect(result).toEqual({ sessions: [], total: 0, hasMore: false });
    expect(readMonthIndex).toHaveBeenCalledTimes(2);
  });

  it('filters sessions by matchesSession predicate', async () => {
    const sessions = [
      makeSession({ chatSession_id: 's1', schedulerJobId: 'job-A' }),
      makeSession({ chatSession_id: 's2', schedulerJobId: 'job-B' }),
      makeSession({ chatSession_id: 's3', schedulerJobId: 'job-A' }),
    ];
    const readMonthIndex = vi.fn().mockResolvedValue({ sessions });
    const matchesSession = (s: ChatSession) => s.schedulerJobId === 'job-A';

    const result = await collectScheduledSessionPage(
      ['202601'],
      readMonthIndex,
      matchesSession,
    );

    expect(result.total).toBe(2);
    expect(result.sessions.map(s => s.chatSession_id)).toEqual(['s1', 's3']);
  });

  it('sorts sessions by last_updated descending', async () => {
    const sessions = [
      makeSession({ chatSession_id: 's1', last_updated: '2026-01-10T10:00:00Z' }),
      makeSession({ chatSession_id: 's2', last_updated: '2026-01-15T10:00:00Z' }),
      makeSession({ chatSession_id: 's3', last_updated: '2026-01-12T10:00:00Z' }),
    ];
    const readMonthIndex = vi.fn().mockResolvedValue({ sessions });

    const result = await collectScheduledSessionPage(
      ['202601'],
      readMonthIndex,
      () => true,
    );

    expect(result.sessions.map(s => s.chatSession_id)).toEqual(['s2', 's3', 's1']);
  });

  it('applies limit and offset correctly', async () => {
    const sessions = Array.from({ length: 50 }, (_, i) =>
      makeSession({
        chatSession_id: `s${i}`,
        last_updated: new Date(2026, 0, 15, 10, i).toISOString(),
      })
    );
    const readMonthIndex = vi.fn().mockResolvedValue({ sessions });

    const options: ScheduledSessionPageOptions = { limit: 10, offset: 5 };
    const result = await collectScheduledSessionPage(
      ['202601'],
      readMonthIndex,
      () => true,
      options,
    );

    expect(result.sessions.length).toBe(10);
    expect(result.total).toBe(50);
    expect(result.hasMore).toBe(true);
  });

  it('returns hasMore=false when offset+limit >= total', async () => {
    const sessions = [
      makeSession({ chatSession_id: 's1' }),
      makeSession({ chatSession_id: 's2' }),
    ];
    const readMonthIndex = vi.fn().mockResolvedValue({ sessions });

    const options: ScheduledSessionPageOptions = { limit: 10, offset: 0 };
    const result = await collectScheduledSessionPage(
      ['202601'],
      readMonthIndex,
      () => true,
      options,
    );

    expect(result.sessions.length).toBe(2);
    expect(result.total).toBe(2);
    expect(result.hasMore).toBe(false);
  });

  it('uses default limit=20 and offset=0 when options not provided', async () => {
    const sessions = Array.from({ length: 25 }, (_, i) =>
      makeSession({ chatSession_id: `s${i}` })
    );
    const readMonthIndex = vi.fn().mockResolvedValue({ sessions });

    const result = await collectScheduledSessionPage(
      ['202601'],
      readMonthIndex,
      () => true,
    );

    expect(result.sessions.length).toBe(20);
    expect(result.total).toBe(25);
    expect(result.hasMore).toBe(true);
  });

  it('collects sessions across multiple months', async () => {
    const jan = [makeSession({ chatSession_id: 's1', last_updated: '2026-01-15T10:00:00Z' })];
    const feb = [makeSession({ chatSession_id: 's2', last_updated: '2026-02-15T10:00:00Z' })];

    const readMonthIndex = vi.fn()
      .mockResolvedValueOnce({ sessions: jan })
      .mockResolvedValueOnce({ sessions: feb });

    const result = await collectScheduledSessionPage(
      ['202601', '202602'],
      readMonthIndex,
      () => true,
    );

    expect(result.total).toBe(2);
    // Feb is more recent, so it should be first
    expect(result.sessions.map(s => s.chatSession_id)).toEqual(['s2', 's1']);
  });
});

describe('queryScheduledSessionPage', () => {
  const mockLogger = {
    info: vi.fn(),
    error: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty result when chatIndex is null', async () => {
    const result = await queryScheduledSessionPage({
      alias: 'testuser',
      chatId: 'chat-1',
      operation: 'test',
      readChatIndex: vi.fn().mockResolvedValue(null),
      readMonthIndex: vi.fn(),
      matchesSession: () => true,
      logger: mockLogger,
    });

    expect(result).toEqual({ sessions: [], total: 0, hasMore: false });
  });

  it('returns empty result when months array is empty', async () => {
    const result = await queryScheduledSessionPage({
      alias: 'testuser',
      chatId: 'chat-1',
      operation: 'test',
      readChatIndex: vi.fn().mockResolvedValue({ months: [] }),
      readMonthIndex: vi.fn(),
      matchesSession: () => true,
      logger: mockLogger,
    });

    expect(result).toEqual({ sessions: [], total: 0, hasMore: false });
  });

  it('logs success with correct parameters', async () => {
    const sessions = [makeSession()];
    const result = await queryScheduledSessionPage({
      alias: 'testuser',
      chatId: 'chat-1',
      options: { limit: 10, offset: 0 },
      operation: 'getScheduledSessions',
      logContext: { schedulerJobId: 'job-123' },
      readChatIndex: vi.fn().mockResolvedValue({ months: ['202601'] }),
      readMonthIndex: vi.fn().mockResolvedValue({ sessions }),
      matchesSession: () => true,
      logger: mockLogger,
    });

    expect(result.sessions.length).toBe(1);
    expect(mockLogger.info).toHaveBeenCalledWith(
      '[ChatSessionManager] getScheduledSessions completed',
      'getScheduledSessions',
      expect.objectContaining({
        alias: 'testuser',
        chatId: 'chat-1',
        schedulerJobId: 'job-123',
        limit: 10,
        offset: 0,
        totalMatches: 1,
        returnedCount: 1,
        hasMore: false,
      }),
    );
  });

  it('handles error and returns empty result', async () => {
    const result = await queryScheduledSessionPage({
      alias: 'testuser',
      chatId: 'chat-1',
      operation: 'getScheduledSessions',
      readChatIndex: vi.fn().mockRejectedValue(new Error('Database error')),
      readMonthIndex: vi.fn(),
      matchesSession: () => true,
      logger: mockLogger,
    });

    expect(result).toEqual({ sessions: [], total: 0, hasMore: false });
    expect(mockLogger.error).toHaveBeenCalledWith(
      '[ChatSessionManager] getScheduledSessions failed',
      'getScheduledSessions',
      expect.objectContaining({
        alias: 'testuser',
        chatId: 'chat-1',
        error: 'Database error',
      }),
    );
  });

  it('handles non-Error exceptions', async () => {
    const result = await queryScheduledSessionPage({
      alias: 'testuser',
      chatId: 'chat-1',
      operation: 'test',
      readChatIndex: vi.fn().mockRejectedValue('string error'),
      readMonthIndex: vi.fn(),
      matchesSession: () => true,
      logger: mockLogger,
    });

    expect(result).toEqual({ sessions: [], total: 0, hasMore: false });
    expect(mockLogger.error).toHaveBeenCalledWith(
      '[ChatSessionManager] test failed',
      'test',
      expect.objectContaining({ error: 'string error' }),
    );
  });

  it('uses default limit and offset when options not provided', async () => {
    const sessions = Array.from({ length: 25 }, (_, i) => makeSession({ chatSession_id: `s${i}` }));

    const result = await queryScheduledSessionPage({
      alias: 'testuser',
      chatId: 'chat-1',
      operation: 'test',
      readChatIndex: vi.fn().mockResolvedValue({ months: ['202601'] }),
      readMonthIndex: vi.fn().mockResolvedValue({ sessions }),
      matchesSession: () => true,
      logger: mockLogger,
    });

    expect(result.sessions.length).toBe(20);
    expect(result.hasMore).toBe(true);
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.any(String),
      'test',
      expect.objectContaining({ limit: 20, offset: 0 }),
    );
  });
});
