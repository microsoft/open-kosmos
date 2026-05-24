import { INTERRUPTED_SCHEDULED_SESSION_ERROR, isInterruptedScheduledSessionError } from '../scheduler';

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

    it('returns false for null', () => {
      expect(isInterruptedScheduledSessionError(null)).toBe(false);
    });

    it('returns false for undefined', () => {
      expect(isInterruptedScheduledSessionError(undefined)).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(isInterruptedScheduledSessionError('')).toBe(false);
    });

    it('returns false for unrelated error', () => {
      expect(isInterruptedScheduledSessionError('Some other error')).toBe(false);
    });
  });
});
