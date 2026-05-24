import {
  buildDailyMultiTimesCronExpression,
  parseDailyMultiTimesCronExpression,
  describeCronExpression,
} from '../cronDescriptions';

describe('cronDescriptions', () => {
  describe('buildDailyMultiTimesCronExpression', () => {
    it('builds cron for single time', () => {
      const result = buildDailyMultiTimesCronExpression('08:00');
      expect(result.cronExpression).toBe('0 8 * * *');
      expect(result.normalizedTimes).toEqual(['08:00']);
      expect(result.error).toBeUndefined();
    });

    it('builds cron for multiple times with same minute', () => {
      const result = buildDailyMultiTimesCronExpression('08:00, 14:00, 20:00');
      expect(result.cronExpression).toBe('0 8,14,20 * * *');
      expect(result.normalizedTimes).toEqual(['08:00', '14:00', '20:00']);
    });

    it('deduplicates times', () => {
      const result = buildDailyMultiTimesCronExpression('08:00, 08:00');
      expect(result.normalizedTimes).toEqual(['08:00']);
    });

    it('handles Chinese comma', () => {
      const result = buildDailyMultiTimesCronExpression('08:30，14:30');
      expect(result.cronExpression).toBe('30 8,14 * * *');
    });

    it('returns error for empty input', () => {
      const result = buildDailyMultiTimesCronExpression('');
      expect(result.error).toBeDefined();
      expect(result.normalizedTimes).toEqual([]);
    });

    it('returns error for invalid time format', () => {
      const result = buildDailyMultiTimesCronExpression('25:00');
      expect(result.error).toContain('Invalid time');
    });

    it('returns error for different minutes', () => {
      const result = buildDailyMultiTimesCronExpression('08:00, 14:30');
      expect(result.error).toContain('same minute');
    });
  });

  describe('parseDailyMultiTimesCronExpression', () => {
    it('parses multi-hour cron to time strings', () => {
      expect(parseDailyMultiTimesCronExpression('0 8,14,20 * * *')).toEqual(['08:00', '14:00', '20:00']);
    });

    it('returns null for empty input', () => {
      expect(parseDailyMultiTimesCronExpression(undefined)).toBeNull();
      expect(parseDailyMultiTimesCronExpression('')).toBeNull();
    });

    it('returns null for non-daily cron', () => {
      expect(parseDailyMultiTimesCronExpression('0 8 1 * *')).toBeNull(); // specific day of month
      expect(parseDailyMultiTimesCronExpression('0 8 * 1 *')).toBeNull(); // specific month
      expect(parseDailyMultiTimesCronExpression('0 8 * * 1')).toBeNull(); // specific weekday
    });

    it('returns null for single hour', () => {
      expect(parseDailyMultiTimesCronExpression('0 8 * * *')).toBeNull(); // need >= 2 hours
    });

    it('returns null for multiple minutes', () => {
      expect(parseDailyMultiTimesCronExpression('0,30 8,14 * * *')).toBeNull();
    });

    it('returns null for non-numeric hours', () => {
      expect(parseDailyMultiTimesCronExpression('0 */2 * * *')).toBeNull();
    });

    it('handles 6-part cron (with seconds)', () => {
      expect(parseDailyMultiTimesCronExpression('0 30 8,14 * * *')).toEqual(['08:30', '14:30']);
    });

    it('returns null for invalid format', () => {
      expect(parseDailyMultiTimesCronExpression('invalid')).toBeNull();
    });
  });

  describe('describeCronExpression', () => {
    it('returns "No cron expression" for empty', () => {
      expect(describeCronExpression(undefined)).toBe('No cron expression');
      expect(describeCronExpression('')).toBe('No cron expression');
    });

    it('returns raw cron for invalid format', () => {
      expect(describeCronExpression('invalid')).toBe('invalid');
    });

    it('describes every minute', () => {
      expect(describeCronExpression('* * * * *')).toBe('Every minute');
    });

    it('describes at minute N of every hour', () => {
      expect(describeCronExpression('30 * * * *')).toBe('At minute 30 of every hour');
    });

    it('describes every N minutes', () => {
      expect(describeCronExpression('*/5 * * * *')).toBe('Every 5 minutes');
    });

    it('describes every N hours', () => {
      expect(describeCronExpression('0 */2 * * *')).toBe('Every 2 hours');
    });

    it('describes every day at single time', () => {
      expect(describeCronExpression('30 8 * * *')).toBe('Every day at 08:30');
    });

    it('describes every day at multiple times', () => {
      expect(describeCronExpression('0 8,14 * * *')).toBe('Every day at 08:00, 14:00');
    });

    it('describes weekdays', () => {
      expect(describeCronExpression('0 9 * * 1-5')).toBe('Weekdays at 09:00');
    });

    it('describes weekdays at multiple times', () => {
      expect(describeCronExpression('30 8,17 * * 1-5')).toBe('Weekdays at 08:30, 17:30');
    });

    it('describes weekends', () => {
      expect(describeCronExpression('0 10 * * 0,6')).toBe('Weekends at 10:00');
      expect(describeCronExpression('0 10 * * 6,0')).toBe('Weekends at 10:00');
    });

    it('describes weekends at multiple times', () => {
      expect(describeCronExpression('0 9,17 * * 0,6')).toBe('Weekends at 09:00, 17:00');
      expect(describeCronExpression('30 8,12 * * 6,0')).toBe('Weekends at 08:30, 12:30');
    });

    it('describes specific weekday', () => {
      expect(describeCronExpression('0 9 * * 1')).toBe('Mon 09:00');
      expect(describeCronExpression('0 9 * * 0')).toBe('Sun 09:00');
    });

    it('describes specific weekday at multiple times', () => {
      expect(describeCronExpression('0 9,17 * * 3')).toBe('Wed 09:00, 17:00');
    });

    it('falls back to raw cron when both minute and hour use step syntax', () => {
      expect(describeCronExpression('*/5 */2 * * *')).toBe('*/5 */2 * * *');
    });

    it('falls back to raw cron for complex expressions', () => {
      expect(describeCronExpression('0 9 1 1 *')).toBe('0 9 1 1 *');
    });

    it('falls back to raw cron when minute is non-numeric with weekday', () => {
      expect(describeCronExpression('*/5 9 * * 1-5')).toBe('*/5 9 * * 1-5');
    });

    it('falls back to raw cron when hour is non-numeric with weekday', () => {
      expect(describeCronExpression('0 */2 * * 0,6')).toBe('0 */2 * * 0,6');
    });

    it('falls back to raw cron for specific weekday with non-numeric minute', () => {
      expect(describeCronExpression('*/10 9 * * 3')).toBe('*/10 9 * * 3');
    });
  });
});
