export const INTERRUPTED_SCHEDULED_SESSION_ERROR = 'Interrupted before completion';

export function isInterruptedScheduledSessionError(
  error: string | null | undefined,
): boolean {
  if (!error) {
    return false;
  }

  return error.trim().toLowerCase() === INTERRUPTED_SCHEDULED_SESSION_ERROR.toLowerCase();
}