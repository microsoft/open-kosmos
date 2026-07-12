vi.mock('electron', async () => ({
  app: {
    getPath: vi.fn(() => '/mock/userData'),
  },
}));
vi.mock('fs');
vi.mock('../../unifiedLogger', async () => import('../../__mocks__/unifiedLogger'));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import { ChatSessionManager } from '../chatSessionManager';
import type { ChatSession } from '../types/profile';

function makeSession(
  id: string,
  lastUpdated: string,
  opts?: { schedulerJobId?: string },
): ChatSession {
  return {
    chatSession_id: id,
    last_updated: lastUpdated,
    title: `Session ${id}`,
    readStatus: 'read',
    ...(opts?.schedulerJobId ? { schedulerJobId: opts.schedulerJobId } : {}),
  } as ChatSession;
}

function mockFs(files: Record<string, object>) {
  (fs.existsSync as any).mockImplementation((p: string) =>
    Object.keys(files).some(k => p.replace(/\\/g, '/').endsWith(k)),
  );
  (fs.promises.readFile as any).mockImplementation(async (p: string) => {
    const match = Object.entries(files).find(([k]) =>
      p.replace(/\\/g, '/').endsWith(k),
    );
    if (match) return JSON.stringify(match[1]);
    throw new Error(`ENOENT: ${p}`);
  });
}

describe('ChatSessionManager.getScheduledSessionsByJobId', () => {
  let manager: ChatSessionManager;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset singleton
    (ChatSessionManager as any).instance = undefined;
    manager = ChatSessionManager.getInstance();
  });

  it('should return only sessions matching the schedulerJobId', async () => {
    const sessions = [
      makeSession('sess_1', '2026-05-20T00:00:00Z', { schedulerJobId: 'job_target' }),
      makeSession('sess_2', '2026-05-19T00:00:00Z', { schedulerJobId: 'job_other' }),
      makeSession('sess_3', '2026-05-18T00:00:00Z', { schedulerJobId: 'job_target' }),
      makeSession('sess_4', '2026-05-17T00:00:00Z'), // no schedulerJobId
      makeSession('sess_5', '2026-05-16T00:00:00Z', { schedulerJobId: 'job_target' }),
    ];

    mockFs({
      'chat_sessions/chat_1/index.json': {
        chat_id: 'chat_1',
        months: ['202605'],
        last_updated: '2026-05-20T00:00:00Z',
      },
      'chat_sessions/chat_1/202605/index.json': {
        chat_id: 'chat_1',
        month: '202605',
        sessions,
        last_updated: '2026-05-20T00:00:00Z',
      },
    });

    const result = await manager.getScheduledSessionsByJobId('testuser', 'chat_1', 'job_target');

    expect(result.sessions.map(s => s.chatSession_id)).toEqual(['sess_1', 'sess_3', 'sess_5']);
    expect(result.total).toBe(3);
    expect(result.hasMore).toBe(false);
  });

  it('should respect limit parameter', async () => {
    const sessions = Array.from({ length: 50 }, (_, i) =>
      makeSession(`sess_${i}`, `2026-05-${String(28 - (i % 28)).padStart(2, '0')}T00:00:00Z`, {
        schedulerJobId: 'job_target',
      }),
    );

    mockFs({
      'chat_sessions/chat_2/index.json': {
        chat_id: 'chat_2',
        months: ['202605'],
        last_updated: '2026-05-28T00:00:00Z',
      },
      'chat_sessions/chat_2/202605/index.json': {
        chat_id: 'chat_2',
        month: '202605',
        sessions,
        last_updated: '2026-05-28T00:00:00Z',
      },
    });

    const result = await manager.getScheduledSessionsByJobId('testuser', 'chat_2', 'job_target', {
      limit: 10,
    });

    expect(result.sessions.length).toBe(10);
    expect(result.total).toBe(50);
    expect(result.hasMore).toBe(true);
  });

  it('should respect offset parameter', async () => {
    const sessions = Array.from({ length: 30 }, (_, i) =>
      makeSession(`sess_${i}`, `2026-05-${String(28 - i).padStart(2, '0')}T00:00:00Z`, {
        schedulerJobId: 'job_target',
      }),
    );

    mockFs({
      'chat_sessions/chat_3/index.json': {
        chat_id: 'chat_3',
        months: ['202605'],
        last_updated: '2026-05-28T00:00:00Z',
      },
      'chat_sessions/chat_3/202605/index.json': {
        chat_id: 'chat_3',
        month: '202605',
        sessions,
        last_updated: '2026-05-28T00:00:00Z',
      },
    });

    const result = await manager.getScheduledSessionsByJobId('testuser', 'chat_3', 'job_target', {
      limit: 10,
      offset: 20,
    });

    expect(result.sessions.length).toBe(10);
    expect(result.sessions[0].chatSession_id).toBe('sess_20');
    expect(result.total).toBe(30);
    expect(result.hasMore).toBe(false);
  });

  it('should search across multiple months', async () => {
    const sessions202605 = [
      makeSession('sess_05_1', '2026-05-20T00:00:00Z', { schedulerJobId: 'job_target' }),
      makeSession('sess_05_2', '2026-05-15T00:00:00Z', { schedulerJobId: 'job_target' }),
    ];
    const sessions202604 = [
      makeSession('sess_04_1', '2026-04-25T00:00:00Z', { schedulerJobId: 'job_target' }),
      makeSession('sess_04_2', '2026-04-20T00:00:00Z', { schedulerJobId: 'job_other' }),
    ];
    const sessions202603 = [
      makeSession('sess_03_1', '2026-03-20T00:00:00Z', { schedulerJobId: 'job_target' }),
    ];

    mockFs({
      'chat_sessions/chat_4/index.json': {
        chat_id: 'chat_4',
        months: ['202605', '202604', '202603'],
        last_updated: '2026-05-20T00:00:00Z',
      },
      'chat_sessions/chat_4/202605/index.json': {
        chat_id: 'chat_4',
        month: '202605',
        sessions: sessions202605,
        last_updated: '2026-05-20T00:00:00Z',
      },
      'chat_sessions/chat_4/202604/index.json': {
        chat_id: 'chat_4',
        month: '202604',
        sessions: sessions202604,
        last_updated: '2026-04-25T00:00:00Z',
      },
      'chat_sessions/chat_4/202603/index.json': {
        chat_id: 'chat_4',
        month: '202603',
        sessions: sessions202603,
        last_updated: '2026-03-20T00:00:00Z',
      },
    });

    const result = await manager.getScheduledSessionsByJobId('testuser', 'chat_4', 'job_target');

    expect(result.sessions.map(s => s.chatSession_id)).toEqual([
      'sess_05_1',
      'sess_05_2',
      'sess_04_1',
      'sess_03_1',
    ]);
    expect(result.total).toBe(4);
    expect(result.hasMore).toBe(false);
  });

  it('should keep scanning after an exact page boundary to compute hasMore', async () => {
    const sessions202605 = Array.from({ length: 15 }, (_, i) =>
      makeSession(`sess_05_${i}`, `2026-05-${String(28 - i).padStart(2, '0')}T00:00:00Z`, {
        schedulerJobId: 'job_target',
      }),
    );
    const sessions202604 = Array.from({ length: 5 }, (_, i) =>
      makeSession(`sess_04_${i}`, `2026-04-${String(28 - i).padStart(2, '0')}T00:00:00Z`, {
        schedulerJobId: 'job_target',
      }),
    );
    const sessions202603 = Array.from({ length: 5 }, (_, i) =>
      makeSession(`sess_03_${i}`, `2026-03-${String(28 - i).padStart(2, '0')}T00:00:00Z`, {
        schedulerJobId: 'job_target',
      }),
    );

    const monthIndexReads: string[] = [];
    (fs.existsSync as any).mockReturnValue(true);
    (fs.promises.readFile as any).mockImplementation(async (p: string) => {
      const normalizedPath = p.replace(/\\/g, '/');
      if (normalizedPath.endsWith('chat_sessions/chat_5/index.json')) {
        return JSON.stringify({
          chat_id: 'chat_5',
          months: ['202605', '202604', '202603'],
          last_updated: '2026-05-28T00:00:00Z',
        });
      }
      if (normalizedPath.includes('202605/index.json')) {
        monthIndexReads.push('202605');
        return JSON.stringify({
          chat_id: 'chat_5',
          month: '202605',
          sessions: sessions202605,
          last_updated: '2026-05-28T00:00:00Z',
        });
      }
      if (normalizedPath.includes('202604/index.json')) {
        monthIndexReads.push('202604');
        return JSON.stringify({
          chat_id: 'chat_5',
          month: '202604',
          sessions: sessions202604,
          last_updated: '2026-04-28T00:00:00Z',
        });
      }
      if (normalizedPath.includes('202603/index.json')) {
        monthIndexReads.push('202603');
        return JSON.stringify({
          chat_id: 'chat_5',
          month: '202603',
          sessions: sessions202603,
          last_updated: '2026-03-28T00:00:00Z',
        });
      }
      throw new Error(`ENOENT: ${p}`);
    });

    const result = await manager.getScheduledSessionsByJobId('testuser', 'chat_5', 'job_target', {
      limit: 20,
    });

    expect(result.sessions.length).toBe(20);
    expect(result.hasMore).toBe(true);
    expect(result.total).toBe(25);

    expect(monthIndexReads).toContain('202605');
    expect(monthIndexReads).toContain('202604');
    expect(monthIndexReads).toContain('202603');
  });

  it('should return empty result for non-existent chat', async () => {
    (fs.existsSync as any).mockReturnValue(false);

    const result = await manager.getScheduledSessionsByJobId('testuser', 'chat_nonexistent', 'job_1');

    expect(result.sessions).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.hasMore).toBe(false);
  });

  it('should return empty result when no sessions match the jobId', async () => {
    const sessions = [
      makeSession('sess_1', '2026-05-20T00:00:00Z', { schedulerJobId: 'job_other' }),
      makeSession('sess_2', '2026-05-19T00:00:00Z'), // no schedulerJobId
    ];

    mockFs({
      'chat_sessions/chat_6/index.json': {
        chat_id: 'chat_6',
        months: ['202605'],
        last_updated: '2026-05-20T00:00:00Z',
      },
      'chat_sessions/chat_6/202605/index.json': {
        chat_id: 'chat_6',
        month: '202605',
        sessions,
        last_updated: '2026-05-20T00:00:00Z',
      },
    });

    const result = await manager.getScheduledSessionsByJobId('testuser', 'chat_6', 'job_nonexistent');

    expect(result.sessions).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.hasMore).toBe(false);
  });

  it('should sort sessions by last_updated descending', async () => {
    const sessions = [
      makeSession('old', '2026-05-01T00:00:00Z', { schedulerJobId: 'job_target' }),
      makeSession('new', '2026-05-20T00:00:00Z', { schedulerJobId: 'job_target' }),
      makeSession('mid', '2026-05-10T00:00:00Z', { schedulerJobId: 'job_target' }),
    ];

    mockFs({
      'chat_sessions/chat_7/index.json': {
        chat_id: 'chat_7',
        months: ['202605'],
        last_updated: '2026-05-20T00:00:00Z',
      },
      'chat_sessions/chat_7/202605/index.json': {
        chat_id: 'chat_7',
        month: '202605',
        sessions,
        last_updated: '2026-05-20T00:00:00Z',
      },
    });

    const result = await manager.getScheduledSessionsByJobId('testuser', 'chat_7', 'job_target');

    expect(result.sessions.map(s => s.chatSession_id)).toEqual(['new', 'mid', 'old']);
  });

  it('should use default limit of 20 when not specified', async () => {
    const sessions = Array.from({ length: 50 }, (_, i) =>
      makeSession(`sess_${i}`, `2026-05-${String(28 - (i % 28)).padStart(2, '0')}T00:00:00Z`, {
        schedulerJobId: 'job_target',
      }),
    );

    mockFs({
      'chat_sessions/chat_8/index.json': {
        chat_id: 'chat_8',
        months: ['202605'],
        last_updated: '2026-05-28T00:00:00Z',
      },
      'chat_sessions/chat_8/202605/index.json': {
        chat_id: 'chat_8',
        month: '202605',
        sessions,
        last_updated: '2026-05-28T00:00:00Z',
      },
    });

    const result = await manager.getScheduledSessionsByJobId('testuser', 'chat_8', 'job_target');

    expect(result.sessions.length).toBe(20);
    expect(result.hasMore).toBe(true);
  });

  it('should compute hasMore across months when the first page ends on a boundary', async () => {
    const sessions202605 = Array.from({ length: 20 }, (_, i) =>
      makeSession(`sess_05_${i}`, `2026-05-${String(28 - i).padStart(2, '0')}T00:00:00Z`, {
        schedulerJobId: `job_${i}`,
      }),
    );
    const sessions202604 = [
      makeSession('sess_04_1', '2026-04-20T00:00:00Z', { schedulerJobId: 'job_extra' }),
    ];

    mockFs({
      'chat_sessions/chat_7/index.json': {
        chat_id: 'chat_7',
        months: ['202605', '202604'],
        last_updated: '2026-05-28T00:00:00Z',
      },
      'chat_sessions/chat_7/202605/index.json': {
        chat_id: 'chat_7',
        month: '202605',
        sessions: sessions202605,
        last_updated: '2026-05-28T00:00:00Z',
      },
      'chat_sessions/chat_7/202604/index.json': {
        chat_id: 'chat_7',
        month: '202604',
        sessions: sessions202604,
        last_updated: '2026-04-20T00:00:00Z',
      },
    });

    const result = await manager.getAllScheduledSessions('testuser', 'chat_7');

    expect(result.sessions.length).toBe(20);
    expect(result.total).toBe(21);
    expect(result.hasMore).toBe(true);
  });
});

describe('ChatSessionManager.getAllScheduledSessions', () => {
  let manager: ChatSessionManager;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset singleton
    (ChatSessionManager as any).instance = undefined;
    manager = ChatSessionManager.getInstance();
  });

  it('should return all sessions with schedulerJobId', async () => {
    const sessions = [
      makeSession('sess_1', '2026-05-20T00:00:00Z', { schedulerJobId: 'job_a' }),
      makeSession('sess_2', '2026-05-19T00:00:00Z', { schedulerJobId: 'job_b' }),
      makeSession('sess_3', '2026-05-18T00:00:00Z'), // no schedulerJobId
      makeSession('sess_4', '2026-05-17T00:00:00Z', { schedulerJobId: 'job_a' }),
    ];

    mockFs({
      'chat_sessions/chat_1/index.json': {
        chat_id: 'chat_1',
        months: ['202605'],
        last_updated: '2026-05-20T00:00:00Z',
      },
      'chat_sessions/chat_1/202605/index.json': {
        chat_id: 'chat_1',
        month: '202605',
        sessions,
        last_updated: '2026-05-20T00:00:00Z',
      },
    });

    const result = await manager.getAllScheduledSessions('testuser', 'chat_1');

    expect(result.sessions.map(s => s.chatSession_id)).toEqual(['sess_1', 'sess_2', 'sess_4']);
    expect(result.total).toBe(3);
    expect(result.hasMore).toBe(false);
  });

  it('should respect limit parameter', async () => {
    const sessions = Array.from({ length: 50 }, (_, i) =>
      makeSession(`sess_${i}`, `2026-05-${String(28 - (i % 28)).padStart(2, '0')}T00:00:00Z`, {
        schedulerJobId: `job_${i % 3}`,
      }),
    );

    mockFs({
      'chat_sessions/chat_2/index.json': {
        chat_id: 'chat_2',
        months: ['202605'],
        last_updated: '2026-05-28T00:00:00Z',
      },
      'chat_sessions/chat_2/202605/index.json': {
        chat_id: 'chat_2',
        month: '202605',
        sessions,
        last_updated: '2026-05-28T00:00:00Z',
      },
    });

    const result = await manager.getAllScheduledSessions('testuser', 'chat_2', { limit: 10 });

    expect(result.sessions.length).toBe(10);
    expect(result.total).toBe(50);
    expect(result.hasMore).toBe(true);
  });

  it('should respect offset parameter', async () => {
    const sessions = Array.from({ length: 30 }, (_, i) =>
      makeSession(`sess_${i}`, `2026-05-${String(28 - i).padStart(2, '0')}T00:00:00Z`, {
        schedulerJobId: `job_${i}`,
      }),
    );

    mockFs({
      'chat_sessions/chat_3/index.json': {
        chat_id: 'chat_3',
        months: ['202605'],
        last_updated: '2026-05-28T00:00:00Z',
      },
      'chat_sessions/chat_3/202605/index.json': {
        chat_id: 'chat_3',
        month: '202605',
        sessions,
        last_updated: '2026-05-28T00:00:00Z',
      },
    });

    const result = await manager.getAllScheduledSessions('testuser', 'chat_3', { limit: 10, offset: 20 });

    expect(result.sessions.length).toBe(10);
    expect(result.sessions[0].chatSession_id).toBe('sess_20');
    expect(result.total).toBe(30);
    expect(result.hasMore).toBe(false);
  });

  it('should search across multiple months', async () => {
    const sessions202605 = [
      makeSession('sess_05_1', '2026-05-20T00:00:00Z', { schedulerJobId: 'job_a' }),
      makeSession('sess_05_2', '2026-05-15T00:00:00Z'), // no schedulerJobId
    ];
    const sessions202604 = [
      makeSession('sess_04_1', '2026-04-25T00:00:00Z', { schedulerJobId: 'job_b' }),
    ];

    mockFs({
      'chat_sessions/chat_4/index.json': {
        chat_id: 'chat_4',
        months: ['202605', '202604'],
        last_updated: '2026-05-20T00:00:00Z',
      },
      'chat_sessions/chat_4/202605/index.json': {
        chat_id: 'chat_4',
        month: '202605',
        sessions: sessions202605,
        last_updated: '2026-05-20T00:00:00Z',
      },
      'chat_sessions/chat_4/202604/index.json': {
        chat_id: 'chat_4',
        month: '202604',
        sessions: sessions202604,
        last_updated: '2026-04-25T00:00:00Z',
      },
    });

    const result = await manager.getAllScheduledSessions('testuser', 'chat_4');

    expect(result.sessions.map(s => s.chatSession_id)).toEqual(['sess_05_1', 'sess_04_1']);
    expect(result.total).toBe(2);
  });

  it('should return empty result when no scheduled sessions exist', async () => {
    const sessions = [
      makeSession('sess_1', '2026-05-20T00:00:00Z'), // no schedulerJobId
      makeSession('sess_2', '2026-05-19T00:00:00Z'), // no schedulerJobId
    ];

    mockFs({
      'chat_sessions/chat_5/index.json': {
        chat_id: 'chat_5',
        months: ['202605'],
        last_updated: '2026-05-20T00:00:00Z',
      },
      'chat_sessions/chat_5/202605/index.json': {
        chat_id: 'chat_5',
        month: '202605',
        sessions,
        last_updated: '2026-05-20T00:00:00Z',
      },
    });

    const result = await manager.getAllScheduledSessions('testuser', 'chat_5');

    expect(result.sessions).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.hasMore).toBe(false);
  });

  it('should use default limit of 20 when not specified', async () => {
    const sessions = Array.from({ length: 50 }, (_, i) =>
      makeSession(`sess_${i}`, `2026-05-${String(28 - (i % 28)).padStart(2, '0')}T00:00:00Z`, {
        schedulerJobId: `job_${i}`,
      }),
    );

    mockFs({
      'chat_sessions/chat_6/index.json': {
        chat_id: 'chat_6',
        months: ['202605'],
        last_updated: '2026-05-28T00:00:00Z',
      },
      'chat_sessions/chat_6/202605/index.json': {
        chat_id: 'chat_6',
        month: '202605',
        sessions,
        last_updated: '2026-05-28T00:00:00Z',
      },
    });

    const result = await manager.getAllScheduledSessions('testuser', 'chat_6');

    expect(result.sessions.length).toBe(20);
    expect(result.hasMore).toBe(true);
  });
});
