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

describe('ChatSessionManager.getChatSessions', () => {
  let manager: ChatSessionManager;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset singleton
    (ChatSessionManager as any).instance = undefined;
    manager = ChatSessionManager.getInstance();
  });

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

  it('should load across months until minCount manual sessions are found', async () => {
    // 202605: 100 scheduler sessions, 0 manual
    // 202604: 5 scheduler sessions, 3 manual
    // 202603: 0 scheduler, 8 manual
    const schedulerSessions202605 = Array.from({ length: 100 }, (_, i) =>
      makeSession(`sched_05_${i}`, `2026-05-${String(28 - (i % 28)).padStart(2, '0')}T00:00:00Z`, {
        schedulerJobId: `job_${i}`,
      }),
    );

    const sessions202604 = [
      ...Array.from({ length: 5 }, (_, i) =>
        makeSession(`sched_04_${i}`, `2026-04-${String(28 - i).padStart(2, '0')}T00:00:00Z`, {
          schedulerJobId: `job_04_${i}`,
        }),
      ),
      makeSession('manual_04_1', '2026-04-15T00:00:00Z'),
      makeSession('manual_04_2', '2026-04-10T00:00:00Z'),
      makeSession('manual_04_3', '2026-04-05T00:00:00Z'),
    ];

    const sessions202603 = Array.from({ length: 8 }, (_, i) =>
      makeSession(`manual_03_${i}`, `2026-03-${String(28 - i).padStart(2, '0')}T00:00:00Z`),
    );

    mockFs({
      'chat_sessions/chat_1/index.json': {
        chat_id: 'chat_1',
        months: ['202605', '202604', '202603'],
        last_updated: '2026-05-28T00:00:00Z',
      },
      'chat_sessions/chat_1/202605/index.json': {
        chat_id: 'chat_1',
        month: '202605',
        sessions: schedulerSessions202605,
        last_updated: '2026-05-28T00:00:00Z',
      },
      'chat_sessions/chat_1/202604/index.json': {
        chat_id: 'chat_1',
        month: '202604',
        sessions: sessions202604,
        last_updated: '2026-04-28T00:00:00Z',
      },
      'chat_sessions/chat_1/202603/index.json': {
        chat_id: 'chat_1',
        month: '202603',
        sessions: sessions202603,
        last_updated: '2026-03-28T00:00:00Z',
      },
    });

    const result = await manager.getChatSessions('testuser', 'chat_1', 10);

    const manualSessions = result.sessions.filter(s => !s.schedulerJobId);
    // Should have loaded all 3 months to reach 10+ manual sessions (3 + 8 = 11)
    expect(manualSessions.length).toBe(11);
    expect(result.loadedMonths).toEqual(['202605', '202604', '202603']);
    expect(result.hasMore).toBe(false);
  });

  it('should stop loading when minCount manual sessions are reached', async () => {
    const sessions202605 = Array.from({ length: 12 }, (_, i) =>
      makeSession(`manual_05_${i}`, `2026-05-${String(28 - i).padStart(2, '0')}T00:00:00Z`),
    );

    mockFs({
      'chat_sessions/chat_2/index.json': {
        chat_id: 'chat_2',
        months: ['202605', '202604'],
        last_updated: '2026-05-28T00:00:00Z',
      },
      'chat_sessions/chat_2/202605/index.json': {
        chat_id: 'chat_2',
        month: '202605',
        sessions: sessions202605,
        last_updated: '2026-05-28T00:00:00Z',
      },
    });

    const result = await manager.getChatSessions('testuser', 'chat_2', 10);

    expect(result.sessions.length).toBe(12);
    expect(result.loadedMonths).toEqual(['202605']);
    expect(result.hasMore).toBe(true);
    expect(result.nextMonthIndex).toBe(1);
  });

  it('should not count scheduler sessions toward minCount', async () => {
    // Month with 1000 scheduler sessions and 0 manual — should NOT stop here
    const schedulerOnly = Array.from({ length: 1000 }, (_, i) =>
      makeSession(`sched_${i}`, `2026-05-01T00:00:00Z`, { schedulerJobId: `job_${i}` }),
    );
    const manualSessions = [
      makeSession('manual_1', '2026-04-15T00:00:00Z'),
    ];

    mockFs({
      'chat_sessions/chat_3/index.json': {
        chat_id: 'chat_3',
        months: ['202605', '202604'],
        last_updated: '2026-05-01T00:00:00Z',
      },
      'chat_sessions/chat_3/202605/index.json': {
        chat_id: 'chat_3',
        month: '202605',
        sessions: schedulerOnly,
        last_updated: '2026-05-01T00:00:00Z',
      },
      'chat_sessions/chat_3/202604/index.json': {
        chat_id: 'chat_3',
        month: '202604',
        sessions: manualSessions,
        last_updated: '2026-04-15T00:00:00Z',
      },
    });

    const result = await manager.getChatSessions('testuser', 'chat_3', 10);

    // Should load both months — 202605 has 0 manual, so it continues to 202604
    expect(result.loadedMonths).toEqual(['202605', '202604']);
    const manual = result.sessions.filter(s => !s.schedulerJobId);
    expect(manual.length).toBe(1);
    expect(manual[0].chatSession_id).toBe('manual_1');
    expect(result.hasMore).toBe(false);
  });

  it('should return empty result for non-existent chat', async () => {
    (fs.existsSync as any).mockReturnValue(false);

    const result = await manager.getChatSessions('testuser', 'chat_nonexistent');

    expect(result.sessions).toEqual([]);
    expect(result.hasMore).toBe(false);
  });

  it('should sort sessions by last_updated descending', async () => {
    const sessions = [
      makeSession('old', '2026-05-01T00:00:00Z'),
      makeSession('new', '2026-05-20T00:00:00Z'),
      makeSession('mid', '2026-05-10T00:00:00Z'),
    ];

    mockFs({
      'chat_sessions/chat_4/index.json': {
        chat_id: 'chat_4',
        months: ['202605'],
        last_updated: '2026-05-20T00:00:00Z',
      },
      'chat_sessions/chat_4/202605/index.json': {
        chat_id: 'chat_4',
        month: '202605',
        sessions,
        last_updated: '2026-05-20T00:00:00Z',
      },
    });

    const result = await manager.getChatSessions('testuser', 'chat_4');

    expect(result.sessions.map(s => s.chatSession_id)).toEqual(['new', 'mid', 'old']);
  });
});
