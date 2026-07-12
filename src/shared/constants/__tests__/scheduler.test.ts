import {
  getSchedulerExecutionInterruptionReason,
  INTERRUPTED_SCHEDULED_SESSION_ERROR,
  isInterruptedScheduledSessionError,
  isSchedulerSkippedExecutionError,
  SCHEDULER_MCP_NOT_READY_ERROR,
  SCHEDULER_USER_CANCELLED_ERROR,
  SCHEDULER_SKIPPED_CONCURRENCY_LIMIT_ERROR,
  SCHEDULER_SKIPPED_OVERLAP_ERROR,
} from '../scheduler';

describe('scheduler constants', () => {
  describe('INTERRUPTED_SCHEDULED_SESSION_ERROR', () => {
    it('is a non-empty string', () => {
      expect(typeof INTERRUPTED_SCHEDULED_SESSION_ERROR).toBe('string');
      expect(INTERRUPTED_SCHEDULED_SESSION_ERROR.length).toBeGreaterThan(0);
    });
  });

  describe('isInterruptedScheduledSessionError', () => {
    it('returns true for exact match', () => {
      expect(isInterruptedScheduledSessionError('Interrupted before completion')).toBe(true);
    });

    it('returns true for case-insensitive match', () => {
      expect(isInterruptedScheduledSessionError('INTERRUPTED BEFORE COMPLETION')).toBe(true);
      expect(isInterruptedScheduledSessionError('interrupted before completion')).toBe(true);
    });

    it('returns true for match with leading/trailing whitespace', () => {
      expect(isInterruptedScheduledSessionError('  Interrupted before completion  ')).toBe(true);
    });

    it('returns true for interrupted messages with a detailed suffix', () => {
      expect(isInterruptedScheduledSessionError('Interrupted before completion: skipped-mcp-not-ready')).toBe(true);
    });

    it('returns true for user-cancelled execution errors', () => {
      expect(isInterruptedScheduledSessionError('Operation cancelled during tool execution')).toBe(true);
      expect(isInterruptedScheduledSessionError('Operation canceled by user')).toBe(true);
      expect(isInterruptedScheduledSessionError(SCHEDULER_USER_CANCELLED_ERROR)).toBe(true);
    });

    it('returns true for scheduler skip errors', () => {
      expect(isInterruptedScheduledSessionError(SCHEDULER_MCP_NOT_READY_ERROR)).toBe(true);
      expect(isInterruptedScheduledSessionError(SCHEDULER_SKIPPED_OVERLAP_ERROR)).toBe(true);
      expect(isInterruptedScheduledSessionError(SCHEDULER_SKIPPED_CONCURRENCY_LIMIT_ERROR)).toBe(true);
    });

    it('returns false for null', () => {
      expect(isInterruptedScheduledSessionError(null)).toBe(false);
    });

    it('returns false for undefined', () => {
      expect(isInterruptedScheduledSessionError(undefined)).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(isInterruptedScheduledSessionError('')).toBe(false);
      expect(isInterruptedScheduledSessionError('   ')).toBe(false);
    });

    it('returns false for unrelated error', () => {
      expect(isInterruptedScheduledSessionError('Some other error')).toBe(false);
    });
  });

  describe('isSchedulerSkippedExecutionError', () => {
    it('detects known skipped execution errors', () => {
      expect(isSchedulerSkippedExecutionError(SCHEDULER_MCP_NOT_READY_ERROR)).toBe(true);
      expect(isSchedulerSkippedExecutionError(SCHEDULER_SKIPPED_OVERLAP_ERROR)).toBe(true);
      expect(isSchedulerSkippedExecutionError(SCHEDULER_SKIPPED_CONCURRENCY_LIMIT_ERROR)).toBe(true);
    });

    it('rejects empty or unrelated errors', () => {
      expect(isSchedulerSkippedExecutionError(null)).toBe(false);
      expect(isSchedulerSkippedExecutionError(undefined)).toBe(false);
      expect(isSchedulerSkippedExecutionError('')).toBe(false);
      expect(isSchedulerSkippedExecutionError('Some other error')).toBe(false);
    });
  });

  describe('getSchedulerExecutionInterruptionReason', () => {
    it('maps the generic interruption marker to a readable reason', () => {
      expect(getSchedulerExecutionInterruptionReason(INTERRUPTED_SCHEDULED_SESSION_ERROR)).toBe(
        'App closed before completion',
      );
      expect(getSchedulerExecutionInterruptionReason(undefined)).toBeUndefined();
      expect(getSchedulerExecutionInterruptionReason('Interrupted before completion:')).toBeUndefined();
    });

    it('maps skipped execution errors to readable labels', () => {
      expect(getSchedulerExecutionInterruptionReason(SCHEDULER_MCP_NOT_READY_ERROR)).toBe('MCP server not ready');
      expect(getSchedulerExecutionInterruptionReason(SCHEDULER_SKIPPED_OVERLAP_ERROR)).toBe(
        'Another run is already in progress',
      );
      expect(getSchedulerExecutionInterruptionReason(SCHEDULER_SKIPPED_CONCURRENCY_LIMIT_ERROR)).toBe(
        'Scheduler concurrency limit reached',
      );
    });

    it('strips the generic interruption prefix before mapping details', () => {
      expect(
        getSchedulerExecutionInterruptionReason('Interrupted before completion: skipped-mcp-not-ready'),
      ).toBe('MCP server not ready');
      expect(
        getSchedulerExecutionInterruptionReason('Interrupted before completion: Operation cancelled during tool execution'),
      ).toBe('Cancelled by user');
    });

    it('returns custom interruption details unchanged', () => {
      expect(getSchedulerExecutionInterruptionReason('Interrupted before completion: Browser closed')).toBe(
        'Browser closed',
      );
    });

    it('maps cancellation errors to a readable reason', () => {
      expect(getSchedulerExecutionInterruptionReason('Operation cancelled during model streaming')).toBe(
        'Cancelled by user',
      );
      expect(getSchedulerExecutionInterruptionReason('Operation was canceled')).toBe('Cancelled by user');
      expect(getSchedulerExecutionInterruptionReason(SCHEDULER_USER_CANCELLED_ERROR)).toBe('Cancelled by user');
    });
  });
});
