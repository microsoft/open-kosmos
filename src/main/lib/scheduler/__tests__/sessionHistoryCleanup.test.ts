import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isHighFrequencyCron,
  getEffectiveRetentionLimits,
  identifySessionsToDelete,
  cleanupSchedulerSessionHistory,
  cleanupAllSchedulerSessionHistory,
  cleanupOrphanSchedulerSessions,
} from '../sessionHistoryCleanup';
import type { SchedulerJob } from '../types';
import type { ChatSession } from '../../userDataADO/types/profile';
import { chatSessionManager } from '../../userDataADO/chatSessionManager';
import { chatSessionStore } from '../../chat/chatSessionStore';
import { profileCacheManager } from '../../userDataADO/profileCacheManager';

// Mock dependencies
vi.mock('../../userDataADO/chatSessionManager', () => ({
  chatSessionManager: {
    readChatIndex: vi.fn(),
    readMonthIndex: vi.fn(),
  },
}));

vi.mock('../../chat/chatSessionStore', () => ({
  chatSessionStore: {
    deleteSession: vi.fn(),
  },
}));

vi.mock('../../userDataADO/profileCacheManager', () => ({
  profileCacheManager: {
    getAllChatConfigs: vi.fn(),
    deleteChatSession: vi.fn(),
    removeStarredChatSessionIndex: vi.fn().mockResolvedValue(true),
    forceNotifyProfileDataManager: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../unifiedLogger', () => ({
  createConsoleLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

/** Helper: mock chatSessionManager to return sessions from a single month */
function mockSessionsForChat(sessions: ChatSession[]) {
  if (sessions.length === 0) {
    vi.mocked(chatSessionManager.readChatIndex).mockResolvedValue({ months: [] } as any);
  } else {
    vi.mocked(chatSessionManager.readChatIndex).mockResolvedValue({ months: ['202401'] } as any);
    vi.mocked(chatSessionManager.readMonthIndex).mockResolvedValue({ sessions } as any);
  }
}

describe('sessionHistoryCleanup', () => {
  describe('isHighFrequencyCron', () => {
    it('returns false for cron with too few parts', () => {
      expect(isHighFrequencyCron('* *')).toBe(false);
      expect(isHighFrequencyCron('*/5')).toBe(false);
    });

    it('returns false for undefined', () => {
      expect(isHighFrequencyCron(undefined)).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(isHighFrequencyCron('')).toBe(false);
    });

    it('returns true for every 5 minutes', () => {
      expect(isHighFrequencyCron('*/5 * * * *')).toBe(true);
    });

    it('returns true for every minute wildcard cron', () => {
      expect(isHighFrequencyCron('* * * * *')).toBe(true);
    });

    it('returns true for every 10 minutes', () => {
      expect(isHighFrequencyCron('*/10 * * * *')).toBe(true);
    });

    it('returns true for every 15 minutes', () => {
      expect(isHighFrequencyCron('*/15 * * * *')).toBe(true);
    });

    it('returns true for every 30 minutes', () => {
      expect(isHighFrequencyCron('*/30 * * * *')).toBe(true);
    });

    it('returns false for every hour (*/60)', () => {
      expect(isHighFrequencyCron('*/60 * * * *')).toBe(false);
    });

    it('returns false for hourly (0 * * * *)', () => {
      expect(isHighFrequencyCron('0 * * * *')).toBe(false);
    });

    it('returns false for daily at 9am', () => {
      expect(isHighFrequencyCron('0 9 * * *')).toBe(false);
    });

    it('returns false for weekly', () => {
      expect(isHighFrequencyCron('0 0 * * 0')).toBe(false);
    });

    it('handles step with weekday filter', () => {
      expect(isHighFrequencyCron('*/5 * * * 1-5')).toBe(true);
    });

    it('handles multiple specific minutes (high freq)', () => {
      // 0,15,30,45 = 4 times per hour = high frequency
      expect(isHighFrequencyCron('0,15,30,45 * * * *')).toBe(true);
    });

    it('handles two specific minutes (not high freq)', () => {
      // 0,30 = 2 times per hour = high frequency (every 30 min)
      expect(isHighFrequencyCron('0,30 * * * *')).toBe(true);
    });

    it('handles range with step', () => {
      expect(isHighFrequencyCron('0-59/10 * * * *')).toBe(true);
      expect(isHighFrequencyCron('0-59/60 * * * *')).toBe(false);
    });
  });

  describe('getEffectiveRetentionLimits', () => {
    it('returns Infinity for once jobs', () => {
      const job: SchedulerJob = {
        id: 'test-job',
        name: 'Test',
        description: '',
        scheduleType: 'once',
        runAt: '2024-01-01T00:00:00Z',
        enabled: true,
        chat_id: 'agent-1',
        message: 'test',
        status: 'pending',
      };

      const limits = getEffectiveRetentionLimits(job);
      expect(limits.successfulLimit).toBe(Infinity);
      expect(limits.failedLimit).toBe(Infinity);
    });

    it('uses job-specific retention if configured', () => {
      const job: SchedulerJob = {
        id: 'test-job',
        name: 'Test',
        description: '',
        scheduleType: 'cron',
        cronExpression: '*/5 * * * *',
        enabled: true,
        chat_id: 'agent-1',
        message: 'test',
        status: 'pending',
        historyRetention: {
          successfulLimit: 100,
          failedLimit: 50,
        },
      };

      const limits = getEffectiveRetentionLimits(job);
      expect(limits.successfulLimit).toBe(100);
      expect(limits.failedLimit).toBe(50);
    });

    it('returns high-freq defaults for high-frequency cron', () => {
      const job: SchedulerJob = {
        id: 'test-job',
        name: 'Test',
        description: '',
        scheduleType: 'cron',
        cronExpression: '*/5 * * * *',
        enabled: true,
        chat_id: 'agent-1',
        message: 'test',
        status: 'pending',
      };

      const limits = getEffectiveRetentionLimits(job);
      expect(limits.successfulLimit).toBe(20);
      expect(limits.failedLimit).toBe(10);
    });

    it('returns normal-freq defaults for hourly cron', () => {
      const job: SchedulerJob = {
        id: 'test-job',
        name: 'Test',
        description: '',
        scheduleType: 'cron',
        cronExpression: '0 * * * *',
        enabled: true,
        chat_id: 'agent-1',
        message: 'test',
        status: 'pending',
      };

      const limits = getEffectiveRetentionLimits(job);
      expect(limits.successfulLimit).toBe(50);
      expect(limits.failedLimit).toBe(20);
    });
  });

  describe('identifySessionsToDelete', () => {
    const makeSession = (
      id: string,
      status: 'completed' | 'failed' | 'running' | undefined,
      lastUpdated: string
    ): ChatSession => ({
      chatSession_id: id,
      title: `Session ${id}`,
      last_updated: lastUpdated,
      schedulerJobId: 'job-1',
      schedulerExecutionStatus: status,
    });

    it('returns empty array when no sessions', () => {
      const result = identifySessionsToDelete([], { successfulLimit: 10, failedLimit: 5 });
      expect(result).toEqual([]);
    });

    it('returns empty array when within limits', () => {
      const sessions = [
        makeSession('s1', 'completed', '2024-01-03T00:00:00Z'),
        makeSession('s2', 'completed', '2024-01-02T00:00:00Z'),
        makeSession('s3', 'failed', '2024-01-01T00:00:00Z'),
      ];

      const result = identifySessionsToDelete(sessions, { successfulLimit: 10, failedLimit: 5 });
      expect(result).toEqual([]);
    });

    it('identifies excess successful sessions to delete', () => {
      const sessions = [
        makeSession('s1', 'completed', '2024-01-05T00:00:00Z'), // keep
        makeSession('s2', 'completed', '2024-01-04T00:00:00Z'), // keep
        makeSession('s3', 'completed', '2024-01-03T00:00:00Z'), // delete (oldest)
        makeSession('s4', 'completed', '2024-01-02T00:00:00Z'), // delete (oldest)
      ];

      const result = identifySessionsToDelete(sessions, { successfulLimit: 2, failedLimit: 5 });
      expect(result).toEqual(['s3', 's4']);
    });

    it('identifies excess failed sessions to delete', () => {
      const sessions = [
        makeSession('f1', 'failed', '2024-01-03T00:00:00Z'), // keep
        makeSession('f2', 'failed', '2024-01-02T00:00:00Z'), // delete
        makeSession('f3', 'failed', '2024-01-01T00:00:00Z'), // delete
      ];

      const result = identifySessionsToDelete(sessions, { successfulLimit: 10, failedLimit: 1 });
      expect(result).toEqual(['f2', 'f3']);
    });

    it('handles mixed successful and failed sessions', () => {
      const sessions = [
        makeSession('s1', 'completed', '2024-01-06T00:00:00Z'), // keep
        makeSession('f1', 'failed', '2024-01-05T00:00:00Z'), // keep
        makeSession('s2', 'completed', '2024-01-04T00:00:00Z'), // keep
        makeSession('s3', 'completed', '2024-01-03T00:00:00Z'), // delete
        makeSession('f2', 'failed', '2024-01-02T00:00:00Z'), // delete
        makeSession('s4', 'completed', '2024-01-01T00:00:00Z'), // delete
      ];

      const result = identifySessionsToDelete(sessions, { successfulLimit: 2, failedLimit: 1 });
      expect(result).toContain('s3');
      expect(result).toContain('s4');
      expect(result).toContain('f2');
      expect(result).not.toContain('s1');
      expect(result).not.toContain('s2');
      expect(result).not.toContain('f1');
    });

    it('never deletes running sessions', () => {
      const sessions = [
        makeSession('r1', 'running', '2024-01-03T00:00:00Z'),
        makeSession('r2', 'running', '2024-01-02T00:00:00Z'),
        makeSession('s1', 'completed', '2024-01-01T00:00:00Z'),
      ];

      const result = identifySessionsToDelete(sessions, { successfulLimit: 0, failedLimit: 0 });
      // Only s1 should be deleted (completed), running sessions are preserved
      expect(result).toEqual(['s1']);
    });

    it('never deletes sessions with undefined status', () => {
      const sessions = [
        makeSession('u1', undefined, '2024-01-03T00:00:00Z'),
        makeSession('s1', 'completed', '2024-01-02T00:00:00Z'),
        makeSession('s2', 'completed', '2024-01-01T00:00:00Z'),
      ];

      const result = identifySessionsToDelete(sessions, { successfulLimit: 1, failedLimit: 1 });
      // Only oldest completed should be deleted
      expect(result).toEqual(['s2']);
    });

    it('handles Infinity limits', () => {
      const sessions = Array.from({ length: 100 }, (_, i) =>
        makeSession(`s${i}`, 'completed', `2024-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`)
      );

      const result = identifySessionsToDelete(sessions, { successfulLimit: Infinity, failedLimit: Infinity });
      expect(result).toEqual([]);
    });
  });

  describe('cleanupSchedulerSessionHistory', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('returns 0 for one-time jobs', async () => {
      const job: SchedulerJob = {
        id: 'job-1',
        name: 'Once',
        description: '',
        scheduleType: 'once',
        runAt: '2024-01-01T00:00:00Z',
        enabled: true,
        chat_id: 'agent-1',
        message: 'test',
        status: 'completed',
      };

      const result = await cleanupSchedulerSessionHistory('user1', job);
      expect(result.deletedCount).toBe(0);
      expect(chatSessionManager.readChatIndex).not.toHaveBeenCalled();
    });

    it('returns 0 when no sessions exist for the job', async () => {
      const job: SchedulerJob = {
        id: 'job-1',
        name: 'Cron',
        description: '',
        scheduleType: 'cron',
        cronExpression: '*/5 * * * *',
        enabled: true,
        chat_id: 'agent-1',
        message: 'test',
        status: 'pending',
      };

      mockSessionsForChat([]);

      const result = await cleanupSchedulerSessionHistory('user1', job);
      expect(result.deletedCount).toBe(0);
    });

    it('returns 0 when sessions are within limits', async () => {
      const job: SchedulerJob = {
        id: 'job-1',
        name: 'Cron',
        description: '',
        scheduleType: 'cron',
        cronExpression: '*/5 * * * *',
        enabled: true,
        chat_id: 'agent-1',
        message: 'test',
        status: 'pending',
      };

      mockSessionsForChat([
        { chatSession_id: 's1', schedulerJobId: 'job-1', schedulerExecutionStatus: 'completed', title: 'S1', last_updated: '2024-01-01' },
        { chatSession_id: 's2', schedulerJobId: 'job-1', schedulerExecutionStatus: 'failed', title: 'S2', last_updated: '2024-01-02' },
      ] as ChatSession[]);

      const result = await cleanupSchedulerSessionHistory('user1', job);
      expect(result.deletedCount).toBe(0);
    });

    it('deletes excess sessions beyond retention limit', async () => {
      const job: SchedulerJob = {
        id: 'job-1',
        name: 'Cron',
        description: '',
        scheduleType: 'cron',
        cronExpression: '*/5 * * * *',
        enabled: true,
        chat_id: 'agent-1',
        message: 'test',
        status: 'pending',
        historyRetention: { successfulLimit: 1, failedLimit: 1 },
      };

      mockSessionsForChat([
        { chatSession_id: 's1', schedulerJobId: 'job-1', schedulerExecutionStatus: 'completed', title: 'S1', last_updated: '2024-01-03' },
        { chatSession_id: 's2', schedulerJobId: 'job-1', schedulerExecutionStatus: 'completed', title: 'S2', last_updated: '2024-01-02' },
        { chatSession_id: 's3', schedulerJobId: 'job-1', schedulerExecutionStatus: 'completed', title: 'S3', last_updated: '2024-01-01' },
        { chatSession_id: 'f1', schedulerJobId: 'job-1', schedulerExecutionStatus: 'failed', title: 'F1', last_updated: '2024-01-03' },
        { chatSession_id: 'f2', schedulerJobId: 'job-1', schedulerExecutionStatus: 'failed', title: 'F2', last_updated: '2024-01-01' },
        { chatSession_id: 'other', schedulerJobId: 'job-other', schedulerExecutionStatus: 'completed', title: 'Other', last_updated: '2024-01-01' },
      ] as ChatSession[]);

      vi.mocked(chatSessionStore.deleteSession).mockResolvedValue(true);

      const result = await cleanupSchedulerSessionHistory('user1', job);
      // Should delete s2, s3 (excess completed) and f2 (excess failed)
      expect(result.deletedCount).toBe(3);
    });

    it('handles delete failures gracefully', async () => {
      const job: SchedulerJob = {
        id: 'job-1',
        name: 'Cron',
        description: '',
        scheduleType: 'cron',
        cronExpression: '*/5 * * * *',
        enabled: true,
        chat_id: 'agent-1',
        message: 'test',
        status: 'pending',
        historyRetention: { successfulLimit: 0, failedLimit: 0 },
      };

      mockSessionsForChat([
        { chatSession_id: 's1', schedulerJobId: 'job-1', schedulerExecutionStatus: 'completed', title: 'S1', last_updated: '2024-01-01' },
      ] as ChatSession[]);

      vi.mocked(chatSessionStore.deleteSession).mockRejectedValue(new Error('disk full'));

      const result = await cleanupSchedulerSessionHistory('user1', job);
      expect(result.deletedCount).toBe(0);
      expect(result.error).toContain('Failed to delete');
    });

    it('handles readChatIndex failure gracefully', async () => {
      const job: SchedulerJob = {
        id: 'job-1',
        name: 'Cron',
        description: '',
        scheduleType: 'cron',
        cronExpression: '*/5 * * * *',
        enabled: true,
        chat_id: 'agent-1',
        message: 'test',
        status: 'pending',
      };

      vi.mocked(chatSessionManager.readChatIndex).mockRejectedValue(new Error('db corrupt'));

      const result = await cleanupSchedulerSessionHistory('user1', job);
      expect(result.deletedCount).toBe(0);
      expect(result.error).toBe('db corrupt');
    });

    it('handles non-Error thrown in cleanup', async () => {
      const job: SchedulerJob = {
        id: 'job-1',
        name: 'Cron',
        description: '',
        scheduleType: 'cron',
        cronExpression: '*/5 * * * *',
        enabled: true,
        chat_id: 'agent-1',
        message: 'test',
        status: 'pending',
      };

      vi.mocked(chatSessionManager.readChatIndex).mockRejectedValue('string error');

      const result = await cleanupSchedulerSessionHistory('user1', job);
      expect(result.deletedCount).toBe(0);
      expect(result.error).toBe('string error');
    });

    it('returns 0 when toDelete is empty (all sessions are running)', async () => {
      const job: SchedulerJob = {
        id: 'job-1',
        name: 'Cron',
        description: '',
        scheduleType: 'cron',
        cronExpression: '*/5 * * * *',
        enabled: true,
        chat_id: 'agent-1',
        message: 'test',
        status: 'pending',
        historyRetention: { successfulLimit: 0, failedLimit: 0 },
      };

      mockSessionsForChat([
        { chatSession_id: 's1', schedulerJobId: 'job-1', schedulerExecutionStatus: 'running', title: 'S1', last_updated: '2024-01-01' },
        { chatSession_id: 's2', schedulerJobId: 'job-1', schedulerExecutionStatus: 'running', title: 'S2', last_updated: '2024-01-02' },
      ] as ChatSession[]);

      const result = await cleanupSchedulerSessionHistory('user1', job);
      expect(result.deletedCount).toBe(0);
      expect(chatSessionStore.deleteSession).not.toHaveBeenCalled();
    });

    it('handles deleteChatSession returning false', async () => {
      const job: SchedulerJob = {
        id: 'job-1',
        name: 'Cron',
        description: '',
        scheduleType: 'cron',
        cronExpression: '*/5 * * * *',
        enabled: true,
        chat_id: 'agent-1',
        message: 'test',
        status: 'pending',
        historyRetention: { successfulLimit: 0, failedLimit: 0 },
      };

      mockSessionsForChat([
        { chatSession_id: 's1', schedulerJobId: 'job-1', schedulerExecutionStatus: 'completed', title: 'S1', last_updated: '2024-01-01' },
      ] as ChatSession[]);

      vi.mocked(chatSessionStore.deleteSession).mockResolvedValue(false);

      const result = await cleanupSchedulerSessionHistory('user1', job);
      expect(result.deletedCount).toBe(0);
    });
  });

  describe('cleanupOrphanSchedulerSessions', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('deletes sessions whose job no longer exists', async () => {
      const existingJobs: SchedulerJob[] = [
        {
          id: 'job-1',
          name: 'Job 1',
          description: '',
          scheduleType: 'cron',
          cronExpression: '0 9 * * *',
          enabled: true,
          chat_id: 'chat-1',
          message: 'test',
          status: 'pending',
        },
      ];

      vi.mocked(profileCacheManager.getAllChatConfigs).mockReturnValue([
        { chat_id: 'chat-1' } as any,
      ]);

      mockSessionsForChat([
        { chatSession_id: 's1', schedulerJobId: 'job-1', title: 'Keep', last_updated: '2024-01-01' },
        { chatSession_id: 's2', schedulerJobId: 'deleted-job', schedulerExecutionStatus: 'completed', title: 'Delete', last_updated: '2024-01-01' },
        { chatSession_id: 's3', schedulerJobId: 'another-deleted', schedulerExecutionStatus: 'failed', title: 'Delete', last_updated: '2024-01-01' },
      ] as ChatSession[]);

      vi.mocked(chatSessionStore.deleteSession).mockResolvedValue(true);

      const result = await cleanupOrphanSchedulerSessions('user1', existingJobs);

      expect(result.deletedCount).toBe(2);
      expect(chatSessionStore.deleteSession).toHaveBeenCalledTimes(2);
      expect(chatSessionStore.deleteSession).toHaveBeenCalledWith('user1', 'chat-1', 's2');
      expect(chatSessionStore.deleteSession).toHaveBeenCalledWith('user1', 'chat-1', 's3');
    });

    it('returns 0 when no orphans found', async () => {
      const existingJobs: SchedulerJob[] = [
        {
          id: 'job-1',
          name: 'Job 1',
          description: '',
          scheduleType: 'cron',
          cronExpression: '0 9 * * *',
          enabled: true,
          chat_id: 'chat-1',
          message: 'test',
          status: 'pending',
        },
      ];

      vi.mocked(profileCacheManager.getAllChatConfigs).mockReturnValue([
        { chat_id: 'chat-1' } as any,
      ]);

      mockSessionsForChat([
        { chatSession_id: 's1', schedulerJobId: 'job-1', title: 'Keep', last_updated: '2024-01-01' },
        { chatSession_id: 's2', schedulerJobId: null, title: 'No job', last_updated: '2024-01-01' },
      ] as ChatSession[]);

      const result = await cleanupOrphanSchedulerSessions('user1', existingJobs);

      expect(result.deletedCount).toBe(0);
      expect(chatSessionStore.deleteSession).not.toHaveBeenCalled();
    });

    it('scans multiple chats', async () => {
      const existingJobs: SchedulerJob[] = [];

      vi.mocked(profileCacheManager.getAllChatConfigs).mockReturnValue([
        { chat_id: 'chat-1' } as any,
        { chat_id: 'chat-2' } as any,
      ]);

      vi.mocked(chatSessionManager.readChatIndex)
        .mockResolvedValueOnce({ months: ['202401'] } as any)
        .mockResolvedValueOnce({ months: ['202401'] } as any);

      vi.mocked(chatSessionManager.readMonthIndex)
        .mockResolvedValueOnce({ sessions: [
          { chatSession_id: 's1', schedulerJobId: 'orphan-1', schedulerExecutionStatus: 'completed', title: 'Orphan', last_updated: '2024-01-01' },
        ] } as any)
        .mockResolvedValueOnce({ sessions: [
          { chatSession_id: 's2', schedulerJobId: 'orphan-2', schedulerExecutionStatus: 'completed', title: 'Orphan', last_updated: '2024-01-01' },
        ] } as any);

      vi.mocked(chatSessionStore.deleteSession).mockResolvedValue(true);

      const result = await cleanupOrphanSchedulerSessions('user1', existingJobs);

      expect(result.deletedCount).toBe(2);
    });

    it('handles readChatIndex failure for a chat gracefully', async () => {
      const existingJobs: SchedulerJob[] = [];

      vi.mocked(profileCacheManager.getAllChatConfigs).mockReturnValue([
        { chat_id: 'chat-1' } as any,
        { chat_id: 'chat-2' } as any,
      ]);

      vi.mocked(chatSessionManager.readChatIndex)
        .mockRejectedValueOnce(new Error('scan failed'))
        .mockResolvedValueOnce({ months: ['202401'] } as any);

      vi.mocked(chatSessionManager.readMonthIndex)
        .mockResolvedValueOnce({ sessions: [
          { chatSession_id: 's2', schedulerJobId: 'orphan-2', schedulerExecutionStatus: 'completed', title: 'Orphan', last_updated: '2024-01-01' },
        ] } as any);

      vi.mocked(chatSessionStore.deleteSession).mockResolvedValue(true);

      const result = await cleanupOrphanSchedulerSessions('user1', existingJobs);
      // Should still process second chat successfully
      expect(result.deletedCount).toBe(1);
    });

    it('handles delete failure for orphan sessions', async () => {
      const existingJobs: SchedulerJob[] = [];

      vi.mocked(profileCacheManager.getAllChatConfigs).mockReturnValue([
        { chat_id: 'chat-1' } as any,
      ]);

      mockSessionsForChat([
        { chatSession_id: 's1', schedulerJobId: 'orphan-1', schedulerExecutionStatus: 'completed', title: 'Orphan', last_updated: '2024-01-01' },
      ] as ChatSession[]);

      vi.mocked(chatSessionStore.deleteSession).mockRejectedValue(new Error('delete failed'));

      const result = await cleanupOrphanSchedulerSessions('user1', existingJobs);
      expect(result.deletedCount).toBe(0);
      expect(result.error).toContain('Failed to delete');
    });

    it('handles top-level exception gracefully', async () => {
      vi.mocked(profileCacheManager.getAllChatConfigs).mockImplementation(() => { throw new Error('crash'); });

      const result = await cleanupOrphanSchedulerSessions('user1', []);
      expect(result.deletedCount).toBe(0);
      expect(result.error).toBe('crash');
    });

    it('handles top-level non-Error exception', async () => {
      vi.mocked(profileCacheManager.getAllChatConfigs).mockImplementation(() => { throw 'string crash'; });

      const result = await cleanupOrphanSchedulerSessions('user1', []);
      expect(result.deletedCount).toBe(0);
      expect(result.error).toBe('string crash');
    });

    it('preserves running and unknown-status orphan sessions', async () => {
      const existingJobs: SchedulerJob[] = [];

      vi.mocked(profileCacheManager.getAllChatConfigs).mockReturnValue([
        { chat_id: 'chat-1' } as any,
      ]);

      mockSessionsForChat([
        { chatSession_id: 's1', schedulerJobId: 'deleted-job', schedulerExecutionStatus: 'running', title: 'Running', last_updated: '2024-01-01' },
        { chatSession_id: 's2', schedulerJobId: 'deleted-job', schedulerExecutionStatus: undefined, title: 'No status', last_updated: '2024-01-01' },
        { chatSession_id: 's3', schedulerJobId: 'deleted-job', schedulerExecutionStatus: 'completed', title: 'Done', last_updated: '2024-01-01' },
      ] as ChatSession[]);

      vi.mocked(chatSessionStore.deleteSession).mockResolvedValue(true);

      const result = await cleanupOrphanSchedulerSessions('user1', existingJobs);

      // Only the completed one should be deleted; running and undefined are preserved
      expect(result.deletedCount).toBe(1);
      expect(chatSessionStore.deleteSession).toHaveBeenCalledTimes(1);
      expect(chatSessionStore.deleteSession).toHaveBeenCalledWith('user1', 'chat-1', 's3');
    });

    it('handles non-Error thrown during chat scan', async () => {
      const existingJobs: SchedulerJob[] = [];

      vi.mocked(profileCacheManager.getAllChatConfigs).mockReturnValue([
        { chat_id: 'chat-1' } as any,
      ]);

      vi.mocked(chatSessionManager.readChatIndex).mockRejectedValue('non-error string');

      const result = await cleanupOrphanSchedulerSessions('user1', existingJobs);
      expect(result.deletedCount).toBe(0);
    });
  });

  describe('cleanupAllSchedulerSessionHistory', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('returns orphansDeleted count when includeOrphans is true', async () => {
      const jobs: SchedulerJob[] = [
        {
          id: 'job-1',
          name: 'Job 1',
          description: '',
          scheduleType: 'cron',
          cronExpression: '0 9 * * *',
          enabled: true,
          chat_id: 'chat-1',
          message: 'test',
          status: 'pending',
        },
      ];

      vi.mocked(profileCacheManager.getAllChatConfigs).mockReturnValue([
        { chat_id: 'chat-1' } as any,
      ]);

      mockSessionsForChat([
        { chatSession_id: 's1', schedulerJobId: 'job-1', schedulerExecutionStatus: 'completed', title: 'Keep', last_updated: '2024-01-01' },
        { chatSession_id: 's2', schedulerJobId: 'deleted-job', schedulerExecutionStatus: 'completed', title: 'Orphan', last_updated: '2024-01-01' },
      ] as ChatSession[]);

      vi.mocked(chatSessionStore.deleteSession).mockResolvedValue(true);

      const result = await cleanupAllSchedulerSessionHistory('user1', jobs, { includeOrphans: true });

      expect(result.orphansDeleted).toBe(1);
      expect(result.totalDeleted).toBeGreaterThanOrEqual(1);
    });

    it('processes disabled cron jobs during manual bulk cleanup', async () => {
      const jobs: SchedulerJob[] = [
        {
          id: 'disabled-job',
          name: 'Disabled Job',
          description: '',
          scheduleType: 'cron',
          cronExpression: '* * * * *',
          enabled: false,
          chat_id: 'chat-1',
          message: 'test',
          status: 'pending',
        },
      ];

      const sessions = Array.from({ length: 22 }, (_, i) => ({
        chatSession_id: `s${i}`,
        schedulerJobId: 'disabled-job',
        schedulerExecutionStatus: 'completed',
        title: `Session ${i}`,
        last_updated: `2024-01-${String(i + 1).padStart(2, '0')}`,
      })) as ChatSession[];

      mockSessionsForChat(sessions);
      vi.mocked(chatSessionStore.deleteSession).mockResolvedValue(true);

      const result = await cleanupAllSchedulerSessionHistory('user1', jobs, { includeOrphans: false });

      expect(result.jobsProcessed).toBe(1);
      expect(result.totalDeleted).toBe(2);
      expect(chatSessionStore.deleteSession).toHaveBeenCalledTimes(2);
    });

    it('skips orphan cleanup when includeOrphans is false', async () => {
      const jobs: SchedulerJob[] = [];

      vi.mocked(profileCacheManager.getAllChatConfigs).mockReturnValue([
        { chat_id: 'chat-1' } as any,
      ]);

      mockSessionsForChat([
        { chatSession_id: 's1', schedulerJobId: 'deleted-job', schedulerExecutionStatus: 'completed', title: 'Orphan', last_updated: '2024-01-01' },
      ] as ChatSession[]);

      const result = await cleanupAllSchedulerSessionHistory('user1', jobs, { includeOrphans: false });

      expect(result.orphansDeleted).toBe(0);
      expect(profileCacheManager.getAllChatConfigs).not.toHaveBeenCalled();
    });

    it('skips orphan cleanup when includeOrphans is undefined', async () => {
      const jobs: SchedulerJob[] = [];

      const result = await cleanupAllSchedulerSessionHistory('user1', jobs);

      expect(result.orphansDeleted).toBe(0);
      expect(result.jobsProcessed).toBe(0);
    });

    it('counts errors from cleanup and orphan phases', async () => {
      const jobs: SchedulerJob[] = [
        {
          id: 'job-1',
          name: 'Job 1',
          description: '',
          scheduleType: 'cron',
          cronExpression: '0 9 * * *',
          enabled: true,
          chat_id: 'chat-1',
          message: 'test',
          status: 'pending',
        },
      ];

      // Make cleanup return error
      mockSessionsForChat([
        { chatSession_id: 's1', schedulerJobId: 'job-1', schedulerExecutionStatus: 'completed', title: 'S1', last_updated: '2024-01-01' },
      ] as ChatSession[]);

      // Phase 2: orphan cleanup also errors
      vi.mocked(profileCacheManager.getAllChatConfigs).mockImplementation(() => { throw new Error('scan error'); });

      const result = await cleanupAllSchedulerSessionHistory('user1', jobs, { includeOrphans: true });

      // errors should be >= 1 from orphan phase
      expect(result.errors).toBeGreaterThanOrEqual(1);
    });

    it('skips once jobs but processes disabled cron jobs', async () => {
      const jobs: SchedulerJob[] = [
        {
          id: 'job-1',
          name: 'Disabled Cron',
          description: '',
          scheduleType: 'cron',
          cronExpression: '0 9 * * *',
          enabled: false,
          chat_id: 'chat-1',
          message: 'test',
          status: 'pending',
        },
        {
          id: 'job-2',
          name: 'Once Job',
          description: '',
          scheduleType: 'once',
          runAt: '2024-01-01T00:00:00Z',
          enabled: true,
          chat_id: 'chat-1',
          message: 'test',
          status: 'completed',
        },
      ];

      mockSessionsForChat([]);

      const result = await cleanupAllSchedulerSessionHistory('user1', jobs);

      // Once jobs are skipped, disabled cron jobs are still processed
      expect(result.jobsProcessed).toBe(1);
    });
  });

  describe('cleanupSchedulerSessionHistory - additional branch coverage', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('returns 0 when months exist but no sessions match the job ID', async () => {
      const job: SchedulerJob = {
        id: 'job-1',
        name: 'Cron',
        description: '',
        scheduleType: 'cron',
        cronExpression: '*/5 * * * *',
        enabled: true,
        chat_id: 'agent-1',
        message: 'test',
        status: 'pending',
      };

      // Months exist, but sessions belong to a different job
      vi.mocked(chatSessionManager.readChatIndex).mockResolvedValue({ months: ['202401'] } as any);
      vi.mocked(chatSessionManager.readMonthIndex).mockResolvedValue({
        sessions: [
          { chatSession_id: 's1', schedulerJobId: 'other-job', schedulerExecutionStatus: 'completed', title: 'Other', last_updated: '2024-01-01' },
        ],
      } as any);

      const result = await cleanupSchedulerSessionHistory('user1', job);
      expect(result.deletedCount).toBe(0);
      expect(result.errorCount).toBe(0);
    });

    it('returns 0 when readMonthIndex returns null for all months', async () => {
      const job: SchedulerJob = {
        id: 'job-1',
        name: 'Cron',
        description: '',
        scheduleType: 'cron',
        cronExpression: '*/5 * * * *',
        enabled: true,
        chat_id: 'agent-1',
        message: 'test',
        status: 'pending',
      };

      vi.mocked(chatSessionManager.readChatIndex).mockResolvedValue({ months: ['202401', '202402'] } as any);
      vi.mocked(chatSessionManager.readMonthIndex).mockResolvedValue(null as any);

      const result = await cleanupSchedulerSessionHistory('user1', job);
      expect(result.deletedCount).toBe(0);
      expect(result.errorCount).toBe(0);
    });
  });

  describe('cleanupOrphanSchedulerSessions - additional branch coverage', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('filters chats by agentId when option is provided', async () => {
      const existingJobs: SchedulerJob[] = [];

      vi.mocked(profileCacheManager.getAllChatConfigs).mockReturnValue([
        { chat_id: 'chat-1' } as any,
        { chat_id: 'chat-2' } as any,
        { chat_id: 'chat-3' } as any,
      ]);

      vi.mocked(chatSessionManager.readChatIndex).mockResolvedValue({ months: ['202401'] } as any);
      vi.mocked(chatSessionManager.readMonthIndex).mockResolvedValue({
        sessions: [
          { chatSession_id: 's1', schedulerJobId: 'orphan-1', schedulerExecutionStatus: 'completed', title: 'Orphan', last_updated: '2024-01-01' },
        ],
      } as any);

      vi.mocked(chatSessionStore.deleteSession).mockResolvedValue(true);

      const result = await cleanupOrphanSchedulerSessions('user1', existingJobs, { chatId: 'chat-2' });

      // Only chat-2 should be scanned
      expect(chatSessionManager.readChatIndex).toHaveBeenCalledTimes(1);
      expect(chatSessionManager.readChatIndex).toHaveBeenCalledWith('user1', 'chat-2');
      expect(result.deletedCount).toBe(1);
    });

    it('reports deleteSession returning false as an error for orphans', async () => {
      const existingJobs: SchedulerJob[] = [];

      vi.mocked(profileCacheManager.getAllChatConfigs).mockReturnValue([
        { chat_id: 'chat-1' } as any,
      ]);

      mockSessionsForChat([
        { chatSession_id: 's1', schedulerJobId: 'orphan-1', schedulerExecutionStatus: 'completed', title: 'Orphan', last_updated: '2024-01-01' },
        { chatSession_id: 's2', schedulerJobId: 'orphan-2', schedulerExecutionStatus: 'failed', title: 'Orphan2', last_updated: '2024-01-02' },
      ] as ChatSession[]);

      vi.mocked(chatSessionStore.deleteSession).mockResolvedValue(false);

      const result = await cleanupOrphanSchedulerSessions('user1', existingJobs);

      expect(result.deletedCount).toBe(0);
      expect(result.errorCount).toBe(2);
      expect(result.error).toContain('Failed to delete 2 orphan sessions');
    });
  });
});
