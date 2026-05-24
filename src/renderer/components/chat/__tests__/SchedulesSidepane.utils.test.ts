import { getScheduledSessionDisplayState } from '../SchedulesSidepane.utils';
import { INTERRUPTED_SCHEDULED_SESSION_ERROR } from '@shared/constants/scheduler';

describe('getScheduledSessionDisplayState', () => {
  it('returns running for active scheduled sessions', () => {
    expect(
      getScheduledSessionDisplayState({
        schedulerExecutionStatus: 'running',
      } as any),
    ).toBe('running');
  });

  it('returns interrupted for recovered interrupted sessions', () => {
    expect(
      getScheduledSessionDisplayState({
        schedulerExecutionStatus: 'failed',
        schedulerError: INTERRUPTED_SCHEDULED_SESSION_ERROR,
      } as any),
    ).toBe('interrupted');
  });

  it('returns failed for non-interruption failures', () => {
    expect(
      getScheduledSessionDisplayState({
        schedulerExecutionStatus: 'failed',
        schedulerError: 'Request timed out',
      } as any),
    ).toBe('failed');
  });

  it('returns completed by default', () => {
    expect(
      getScheduledSessionDisplayState({
        schedulerExecutionStatus: 'completed',
      } as any),
    ).toBe('completed');
  });
});