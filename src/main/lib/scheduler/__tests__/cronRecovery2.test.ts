import {
  findMissedCronOccurrence,
  getColdStartCatchUpBaseline,
  getSchedulerTimeZone,
  shouldCatchUpMissedOccurrence,
} from '../cronRecovery';

describe('cronRecovery edge cases', () => {
  describe('findMissedCronOccurrence', () => {
    it('returns null for an empty / whitespace cron expression', () => {
      expect(findMissedCronOccurrence('   ', '2026-03-19T00:00:00.000Z', '2026-03-19T08:00:00.000Z', 'UTC')).toBeNull();
    });

    it('returns null when suspendedAt is an invalid date', () => {
      expect(findMissedCronOccurrence('0 * * * *', 'not-a-date', '2026-03-19T08:00:00.000Z', 'UTC')).toBeNull();
    });

    it('returns null when resumedAt is an invalid date', () => {
      expect(findMissedCronOccurrence('0 * * * *', '2026-03-19T00:00:00.000Z', 'bad-date', 'UTC')).toBeNull();
    });

    it('returns null when resumedAt <= suspendedAt', () => {
      expect(
        findMissedCronOccurrence(
          '0 * * * *',
          '2026-03-19T08:00:00.000Z',
          '2026-03-19T07:00:00.000Z',
          'UTC',
        ),
      ).toBeNull();
      expect(
        findMissedCronOccurrence(
          '0 * * * *',
          '2026-03-19T08:00:00.000Z',
          '2026-03-19T08:00:00.000Z',
          'UTC',
        ),
      ).toBeNull();
    });

    it('returns null when the previous cron occurrence is exactly at or before suspendedAt', () => {
      // Job runs at 06:00 every day. Suspended at 06:05 (after it ran). Resumed at 07:00.
      // The previous occurrence from 07:00 would be 06:00 which is <= suspendedAt 06:05.
      const result = findMissedCronOccurrence(
        '0 6 * * *',
        '2026-03-19T06:05:00.000Z',
        '2026-03-19T07:00:00.000Z',
        'UTC',
      );
      expect(result).toBeNull();
    });

    it('returns null for an invalid cron expression (throws internally)', () => {
      expect(
        findMissedCronOccurrence('99 99 99 99 99', '2026-03-19T00:00:00.000Z', '2026-03-19T08:00:00.000Z', 'UTC'),
      ).toBeNull();
    });

    it('returns null when prev occurrence is before the suspend window (not missed)', () => {
      // cron runs at 06:00 daily; window is 05:00-05:30 — prev from 05:30 is 2026-03-18T06:00:00 which is before suspendedAt
      const result = findMissedCronOccurrence(
        '0 6 * * *',
        '2026-03-19T05:00:00.000Z',
        '2026-03-19T05:30:00.000Z',
        'UTC',
      );
      expect(result).toBeNull();
    });

    it('accepts numeric timestamps for suspendedAt and resumedAt', () => {
      const suspended = Date.parse('2026-03-19T05:30:00.000Z');
      const resumed = Date.parse('2026-03-19T07:00:00.000Z');
      const result = findMissedCronOccurrence('15 6 * * *', suspended, resumed, 'UTC');
      expect(result?.toISOString()).toBe('2026-03-19T06:15:00.000Z');
    });

    it('accepts Date objects for suspendedAt and resumedAt', () => {
      const suspended = new Date('2026-03-19T05:30:00.000Z');
      const resumed = new Date('2026-03-19T07:00:00.000Z');
      const result = findMissedCronOccurrence('15 6 * * *', suspended, resumed, 'UTC');
      expect(result?.toISOString()).toBe('2026-03-19T06:15:00.000Z');
    });
  });

  describe('shouldCatchUpMissedOccurrence', () => {
    it('returns false when missedOccurrence is an invalid date', () => {
      expect(shouldCatchUpMissedOccurrence('not-a-date', '2026-03-19T07:00:00.000Z')).toBe(false);
    });

    it('returns false when resumedAt is an invalid date', () => {
      expect(shouldCatchUpMissedOccurrence('2026-03-19T06:00:00.000Z', 'bad')).toBe(false);
    });

    it('returns false when maxDelayMs is negative', () => {
      expect(shouldCatchUpMissedOccurrence('2026-03-19T06:00:00.000Z', '2026-03-19T06:30:00.000Z', -1)).toBe(false);
    });

    it('returns false when maxDelayMs is non-finite (Infinity)', () => {
      expect(shouldCatchUpMissedOccurrence('2026-03-19T06:00:00.000Z', '2026-03-19T06:30:00.000Z', Infinity)).toBe(false);
    });

    it('returns false when maxDelayMs is NaN', () => {
      expect(shouldCatchUpMissedOccurrence('2026-03-19T06:00:00.000Z', '2026-03-19T06:30:00.000Z', NaN)).toBe(false);
    });

    it('returns false when missedOccurrence is after resumedAt', () => {
      expect(shouldCatchUpMissedOccurrence('2026-03-19T08:00:00.000Z', '2026-03-19T07:00:00.000Z')).toBe(false);
    });

    it('returns true when the delay is exactly 0', () => {
      expect(shouldCatchUpMissedOccurrence('2026-03-19T07:00:00.000Z', '2026-03-19T07:00:00.000Z')).toBe(true);
    });

    it('returns true when the delay is exactly maxDelayMs', () => {
      const missed = new Date('2026-03-19T01:00:00.000Z');
      const resumed = new Date(missed.getTime() + 6 * 60 * 60 * 1000);
      expect(shouldCatchUpMissedOccurrence(missed, resumed)).toBe(true);
    });
  });

  describe('getColdStartCatchUpBaseline', () => {
    it('returns null when previousState is null', () => {
      expect(getColdStartCatchUpBaseline(null)).toBeNull();
    });

    it('returns null when isActive=true but lastActivatedAt is missing', () => {
      expect(getColdStartCatchUpBaseline({ isActive: true })).toBeNull();
    });

    it('returns null when isActive=false and both lastActivatedAt and lastDeactivatedAt are missing', () => {
      expect(getColdStartCatchUpBaseline({ isActive: false })).toBeNull();
    });

    it('uses lastActivatedAt when isActive=false and lastDeactivatedAt is missing', () => {
      expect(
        getColdStartCatchUpBaseline({
          isActive: false,
          lastActivatedAt: '2026-03-19T00:00:00.000Z',
        }),
      ).toEqual({ windowStartAt: '2026-03-19T00:00:00.000Z', source: 'clean-exit' });
    });

    it('uses lastDeactivatedAt when isActive=false and lastDeactivatedAt is present', () => {
      expect(
        getColdStartCatchUpBaseline({
          isActive: false,
          lastActivatedAt: '2026-03-19T00:00:00.000Z',
          lastDeactivatedAt: '2026-03-19T02:00:00.000Z',
        }),
      ).toEqual({ windowStartAt: '2026-03-19T02:00:00.000Z', source: 'clean-exit' });
    });
  });

  describe('getSchedulerTimeZone', () => {
    it('returns a non-empty timezone string', () => {
      const tz = getSchedulerTimeZone();
      expect(typeof tz).toBe('string');
      expect(tz.length).toBeGreaterThan(0);
    });
  });
});
