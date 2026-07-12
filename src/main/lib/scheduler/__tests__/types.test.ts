import {
  isSchedulerJobStatus,
  isSchedulerJobType,
  normalizeSchedulerJob,
  normalizeScheduleMonthFile,
} from '../types';

describe('scheduler types', () => {
  describe('isSchedulerJobStatus', () => {
    it('returns true for valid statuses', () => {
      expect(isSchedulerJobStatus('pending')).toBe(true);
      expect(isSchedulerJobStatus('completed')).toBe(true);
      expect(isSchedulerJobStatus('expired')).toBe(true);
      expect(isSchedulerJobStatus('failed')).toBe(true);
    });

    it('returns false for invalid values', () => {
      expect(isSchedulerJobStatus('running')).toBe(false);
      expect(isSchedulerJobStatus('')).toBe(false);
      expect(isSchedulerJobStatus(null)).toBe(false);
      expect(isSchedulerJobStatus(undefined)).toBe(false);
      expect(isSchedulerJobStatus(42)).toBe(false);
    });
  });

  describe('isSchedulerJobType', () => {
    it('returns true for valid types', () => {
      expect(isSchedulerJobType('cron')).toBe(true);
      expect(isSchedulerJobType('once')).toBe(true);
    });

    it('returns false for invalid values', () => {
      expect(isSchedulerJobType('recurring')).toBe(false);
      expect(isSchedulerJobType('')).toBe(false);
      expect(isSchedulerJobType(null)).toBe(false);
    });
  });

  describe('normalizeSchedulerJob', () => {
    it('normalizes a complete valid job', () => {
      const result = normalizeSchedulerJob({
        id: 'sched_20260401000000_dev_abc123456',
        name: 'My Job',
        description: 'desc',
        scheduleType: 'cron',
        cronExpression: '0 * * * *',
        runAt: '2026-05-11T12:00:00.000Z',
        enabled: true,
        chat_id: 'agent-1',
        message: 'hello',
        status: 'pending',
        lastRunAt: '2026-05-10T12:00:00.000Z',
        lastFinishedAt: '2026-05-10T12:01:00.000Z',
        executedAt: '2026-05-10T12:01:00.000Z',
      });

      expect(result.id).toBe('sched_20260401000000_dev_abc123456');
      expect(result.name).toBe('My Job');
      expect(result.scheduleType).toBe('cron');
      expect(result.enabled).toBe(true);
    });

    it('defaults missing optional fields', () => {
      const result = normalizeSchedulerJob({ id: 'sched_20260401000000_dev_abc123456' });
      expect(result.description).toBe('');
      expect(result.name).toBe('');
      expect(result.scheduleType).toBe('cron');
      expect(result.enabled).toBe(true);
      expect(result.chat_id).toBe('');
      expect(result.message).toBe('');
      expect(result.status).toBe('pending');
      expect(result.lastRunAt).toBeUndefined();
      expect(result.lastFinishedAt).toBeUndefined();
      expect(result.executedAt).toBeUndefined();
    });

    it('normalizes scheduleType once', () => {
      const result = normalizeSchedulerJob({ id: 'x', scheduleType: 'once' });
      expect(result.scheduleType).toBe('once');
    });

    it('normalizes invalid status to pending', () => {
      const result = normalizeSchedulerJob({ id: 'x', status: 'invalid' as any });
      expect(result.status).toBe('pending');
    });

    it('normalizes invalid enabled to true', () => {
      const result = normalizeSchedulerJob({ id: 'x', enabled: 'yes' as any });
      expect(result.enabled).toBe(true);
    });

    it('normalizes valid historyRetention', () => {
      const result = normalizeSchedulerJob({
        id: 'x',
        historyRetention: { successfulLimit: 30, failedLimit: 15 },
      });
      expect(result.historyRetention).toEqual({ successfulLimit: 30, failedLimit: 15 });
    });

    it('normalizes historyRetention with only successfulLimit', () => {
      const result = normalizeSchedulerJob({
        id: 'x',
        historyRetention: { successfulLimit: 25 } as any,
      });
      expect(result.historyRetention).toEqual({ successfulLimit: 25, failedLimit: 10 });
    });

    it('normalizes historyRetention with only failedLimit', () => {
      const result = normalizeSchedulerJob({
        id: 'x',
        historyRetention: { failedLimit: 5 } as any,
      });
      expect(result.historyRetention).toEqual({ successfulLimit: 20, failedLimit: 5 });
    });

    it('returns undefined historyRetention for non-object', () => {
      const result = normalizeSchedulerJob({
        id: 'x',
        historyRetention: 'invalid' as any,
      });
      expect(result.historyRetention).toBeUndefined();
    });

    it('returns undefined historyRetention when both limits are invalid', () => {
      const result = normalizeSchedulerJob({
        id: 'x',
        historyRetention: { successfulLimit: -1, failedLimit: -5 } as any,
      });
      expect(result.historyRetention).toBeUndefined();
    });

    it('returns undefined historyRetention for undefined', () => {
      const result = normalizeSchedulerJob({ id: 'x' });
      expect(result.historyRetention).toBeUndefined();
    });
  });

  describe('normalizeScheduleMonthFile', () => {
    it('returns empty array for null input', () => {
      expect(normalizeScheduleMonthFile(null)).toEqual({ schedulerJobs: [] });
    });

    it('returns empty array for non-object input', () => {
      expect(normalizeScheduleMonthFile('string')).toEqual({ schedulerJobs: [] });
      expect(normalizeScheduleMonthFile(42)).toEqual({ schedulerJobs: [] });
    });

    it('normalizes jobs from valid input', () => {
      const result = normalizeScheduleMonthFile({
        schedulerJobs: [
          { id: 'sched_x', name: 'job', enabled: true, chat_id: 'a', message: 'm', status: 'pending', scheduleType: 'cron', description: '' },
        ],
      });
      expect(result.schedulerJobs).toHaveLength(1);
      expect(result.schedulerJobs[0].id).toBe('sched_x');
    });
  });
});
