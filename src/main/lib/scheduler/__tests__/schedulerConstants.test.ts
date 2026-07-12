import {
  getSchedulerExecutionInterruptionReason,
  isInterruptedScheduledSessionError,
  isSchedulerSkippedExecutionError,
  SCHEDULER_ALIAS_CHANGED_ERROR,
  SCHEDULER_MCP_NOT_READY_ERROR,
  SCHEDULER_USER_CANCELLED_ERROR,
} from '../../../../shared/constants/scheduler';

describe('isInterruptedScheduledSessionError', () => {
  it('returns true for the exact error string', () => {
    expect(isInterruptedScheduledSessionError('Interrupted before completion')).toBe(true);
  });

  it('returns true for case-insensitive match', () => {
    expect(isInterruptedScheduledSessionError('INTERRUPTED BEFORE COMPLETION')).toBe(true);
  });

  it('returns true with surrounding whitespace', () => {
    expect(isInterruptedScheduledSessionError('  Interrupted before completion  ')).toBe(true);
  });

  it('returns true for interrupted errors with a detailed suffix', () => {
    expect(isInterruptedScheduledSessionError('Interrupted before completion: skipped-mcp-not-ready')).toBe(true);
  });

  it('returns true for user-cancelled execution errors', () => {
    expect(isInterruptedScheduledSessionError('Operation cancelled during tool execution')).toBe(true);
    expect(isInterruptedScheduledSessionError('Operation was canceled')).toBe(true);
    expect(isInterruptedScheduledSessionError(SCHEDULER_USER_CANCELLED_ERROR)).toBe(true);
  });

  it('returns true for scheduler skip errors', () => {
    expect(isInterruptedScheduledSessionError(SCHEDULER_MCP_NOT_READY_ERROR)).toBe(true);
  });

  it('maps scheduler skip errors to readable interruption reasons', () => {
    expect(isSchedulerSkippedExecutionError(SCHEDULER_MCP_NOT_READY_ERROR)).toBe(true);
    expect(getSchedulerExecutionInterruptionReason(SCHEDULER_MCP_NOT_READY_ERROR)).toBe('MCP server not ready');
  });

  it('treats the alias-changed signal as an internal skip, not a user-facing interruption', () => {
    expect(SCHEDULER_ALIAS_CHANGED_ERROR).toBe('skipped-alias-changed');
    // Internal control signal only: it is never persisted to session metadata, so it
    // must not be classified as a user-facing skip reason or rendered as an interruption.
    expect(isSchedulerSkippedExecutionError(SCHEDULER_ALIAS_CHANGED_ERROR)).toBe(false);
    expect(isInterruptedScheduledSessionError(SCHEDULER_ALIAS_CHANGED_ERROR)).toBe(false);
  });

  it('maps the generic interrupted marker to a readable interruption reason', () => {
    expect(getSchedulerExecutionInterruptionReason('Interrupted before completion')).toBe(
      'App closed before completion',
    );
  });

  it('maps cancellation errors to a readable interruption reason', () => {
    expect(getSchedulerExecutionInterruptionReason('Operation cancelled during model streaming')).toBe(
      'Cancelled by user',
    );
    expect(getSchedulerExecutionInterruptionReason('Operation was canceled')).toBe('Cancelled by user');
    expect(getSchedulerExecutionInterruptionReason(SCHEDULER_USER_CANCELLED_ERROR)).toBe('Cancelled by user');
    expect(
      getSchedulerExecutionInterruptionReason('Interrupted before completion: Operation cancelled during tool execution'),
    ).toBe('Cancelled by user');
  });

  it('returns false for null', () => {
    expect(isInterruptedScheduledSessionError(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isInterruptedScheduledSessionError(undefined)).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isInterruptedScheduledSessionError('')).toBe(false);
  });

  it('returns false for a different error message', () => {
    expect(isInterruptedScheduledSessionError('Some other error')).toBe(false);
  });
});
