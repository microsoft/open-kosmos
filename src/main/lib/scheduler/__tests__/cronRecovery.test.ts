import {
  findMissedCronOccurrence,
  getColdStartCatchUpBaseline,
  MAX_RESUME_CATCH_UP_DELAY_MS,
  shouldCatchUpMissedOccurrence,
} from '../cronRecovery';

describe('findMissedCronOccurrence', () => {
  it('returns the missed recurring occurrence inside the suspend window', () => {
    const missedOccurrence = findMissedCronOccurrence(
      '15 6 * * *',
      '2026-03-19T05:30:53.477Z',
      '2026-03-19T07:40:52.421Z',
      'UTC',
    );

    expect(missedOccurrence?.toISOString()).toBe('2026-03-19T06:15:00.000Z');
  });

  it('returns null when no recurring occurrence is missed', () => {
    const missedOccurrence = findMissedCronOccurrence(
      '15 6 * * *',
      '2026-03-19T06:20:00.000Z',
      '2026-03-19T07:00:00.000Z',
      'UTC',
    );

    expect(missedOccurrence).toBeNull();
  });

  it('returns only the last missed occurrence when multiple runs were skipped', () => {
    const missedOccurrence = findMissedCronOccurrence(
      '0 * * * *',
      '2026-03-19T00:10:00.000Z',
      '2026-03-19T08:20:00.000Z',
      'UTC',
    );

    expect(missedOccurrence?.toISOString()).toBe('2026-03-19T08:00:00.000Z');
  });

  it('allows catch-up only when the missed run is recent enough', () => {
    expect(
      shouldCatchUpMissedOccurrence(
        '2026-03-19T06:15:00.000Z',
        '2026-03-19T07:40:52.421Z',
      ),
    ).toBe(true);

    expect(
      shouldCatchUpMissedOccurrence(
        '2026-03-19T06:15:00.000Z',
        new Date(new Date('2026-03-19T06:15:00.000Z').getTime() + MAX_RESUME_CATCH_UP_DELAY_MS + 1),
      ),
    ).toBe(false);
  });

  it('applies the freshness window to the last missed occurrence, not the first one', () => {
    const missedOccurrence = findMissedCronOccurrence(
      '0 * * * *',
      '2026-03-19T00:10:00.000Z',
      '2026-03-19T08:20:00.000Z',
      'UTC',
    );

    expect(missedOccurrence?.toISOString()).toBe('2026-03-19T08:00:00.000Z');
    expect(shouldCatchUpMissedOccurrence(missedOccurrence as Date, '2026-03-19T08:20:00.000Z')).toBe(true);
  });

  it('uses exitedAt as the cold-start baseline after a clean exit', () => {
    expect(
      getColdStartCatchUpBaseline({
        isActive: false,
        lastActivatedAt: '2026-03-19T00:00:00.000Z',
        lastDeactivatedAt: '2026-03-19T02:00:00.000Z',
      }),
    ).toEqual({
      windowStartAt: '2026-03-19T02:00:00.000Z',
      source: 'clean-exit',
    });
  });

  it('falls back to startedAt as the cold-start baseline after an unclean exit', () => {
    expect(
      getColdStartCatchUpBaseline({
        isActive: true,
        lastActivatedAt: '2026-03-19T00:00:00.000Z',
      }),
    ).toEqual({
      windowStartAt: '2026-03-19T00:00:00.000Z',
      source: 'unclean-exit',
    });
  });
});