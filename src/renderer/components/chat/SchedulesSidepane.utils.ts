import { ChatSession } from '../../lib/userData/types';
import { isInterruptedScheduledSessionError } from '@shared/constants/scheduler';

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