import {
  extractMonthKeyFromScheduleJob,
  generateScheduleJobId,
  getCurrentScheduleMonthKey,
  getMonthKeyFromRunAt,
  isValidScheduleJobId,
} from '../id';

describe('scheduler id helpers', () => {
  describe('generateScheduleJobId', () => {
    it('returns a string matching the schedule job id pattern', () => {
      const id = generateScheduleJobId(new Date(2026, 2, 30, 15, 4, 5));
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
      expect(id).toMatch(/^sched_/);
    });
  });

  describe('isValidScheduleJobId', () => {
    it('accepts the new schedule job id format', () => {
      expect(isValidScheduleJobId('sched_20260330150405_device-01_abc123xyz')).toBe(true);
    });

    it('still accepts the legacy schedule job id format', () => {
      expect(isValidScheduleJobId('sched_20260330150405_abc123xyz')).toBe(true);
    });

    it('rejects malformed schedule job ids', () => {
      expect(isValidScheduleJobId('sched_20260330_device-01_abc123xyz')).toBe(false);
      expect(isValidScheduleJobId('sched_20260330150405_device-only')).toBe(false);
      expect(isValidScheduleJobId('schedule_20260330150405_device-01_abc123xyz')).toBe(false);
    });
  });

  describe('extractMonthKeyFromScheduleJob', () => {
    it('extracts YYYYMM from the new format', () => {
      expect(extractMonthKeyFromScheduleJob('sched_20260330150405_device-01_abc123xyz')).toBe('202603');
    });

    it('extracts YYYYMM from the legacy format', () => {
      expect(extractMonthKeyFromScheduleJob('sched_20251201010203_abc123xyz')).toBe('202512');
    });

    it('returns null for invalid values', () => {
      expect(extractMonthKeyFromScheduleJob('invalid')).toBeNull();
    });
  });

  describe('month helpers', () => {
    it('builds the current month key from a date', () => {
      expect(getCurrentScheduleMonthKey(new Date(2026, 2, 30, 15, 4, 5))).toBe('202603');
    });

    it('derives month key from runAt', () => {
      expect(getMonthKeyFromRunAt('2026-03-30T15:04:05.000Z')).toBe('202603');
      expect(getMonthKeyFromRunAt('not-a-date')).toBeNull();
    });
  });
});