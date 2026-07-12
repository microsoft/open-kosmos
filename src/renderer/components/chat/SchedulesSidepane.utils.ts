import type { ChatSession } from '../../lib/userData/types';
import {
  getSchedulerExecutionInterruptionReason,
  isInterruptedScheduledSessionError,
} from '@shared/constants/scheduler';

export type ScheduledSessionDisplayState =
  | 'running'
  | 'completed'
  | 'failed'
  | 'interrupted';

export function getScheduledSessionDisplayState(
  session: Pick<ChatSession, 'schedulerExecutionStatus' | 'schedulerError'>,
): ScheduledSessionDisplayState {
  if (session.schedulerExecutionStatus === 'running') {
    return 'running';
  }

  if (session.schedulerExecutionStatus === 'failed') {
    return isInterruptedScheduledSessionError(session.schedulerError)
      ? 'interrupted'
      : 'failed';
  }

  return 'completed';
}

export function getScheduledSessionInterruptionReason(
  session: Pick<ChatSession, 'schedulerError'>,
): string | undefined {
  return getSchedulerExecutionInterruptionReason(session.schedulerError);
}