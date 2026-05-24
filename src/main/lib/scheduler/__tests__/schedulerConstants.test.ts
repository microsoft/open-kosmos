import { isInterruptedScheduledSessionError } from '../../../../shared/constants/scheduler';

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
