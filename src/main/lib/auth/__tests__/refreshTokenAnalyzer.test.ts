/**
 * Tests for RefreshTokenAnalyzer — HTTP error analysis, retry strategy,
 * user-friendly messages, shouldStopRetrying, calculateBackoffDelay.
 */

import { RefreshTokenAnalyzer } from '../refreshTokenAnalyzer';
import { RefreshTokenErrorType } from '../types/refreshTokenTypes';

describe('RefreshTokenAnalyzer.analyzeHttpError', () => {
  describe('401 — TOKEN_EXPIRED', () => {
    it('identifies 401 as token expired', () => {
      const result = RefreshTokenAnalyzer.analyzeHttpError({ status: 401, message: 'Unauthorized' });
      expect(result.errorType).toBe(RefreshTokenErrorType.TOKEN_EXPIRED);
      expect(result.isRecoverable).toBe(true);
      expect(result.shouldClearSession).toBe(false);
    });

    it('includes retry strategy with shouldRetry=true', () => {
      const result = RefreshTokenAnalyzer.analyzeHttpError({ status: 401, message: '' });
      expect(result.retryStrategy.shouldRetry).toBe(true);
      expect(result.retryStrategy.maxRetries).toBeGreaterThan(0);
    });
  });

  describe('403 — TOKEN_INVALID', () => {
    it('identifies 403 as token invalid', () => {
      const result = RefreshTokenAnalyzer.analyzeHttpError({ status: 403, message: 'Forbidden' });
      expect(result.errorType).toBe(RefreshTokenErrorType.TOKEN_INVALID);
      expect(result.isRecoverable).toBe(false);
      expect(result.shouldClearSession).toBe(true);
    });

    it('has shouldRetry=false for invalid token', () => {
      const result = RefreshTokenAnalyzer.analyzeHttpError({ status: 403, message: '' });
      expect(result.retryStrategy.shouldRetry).toBe(false);
    });
  });

  describe('429 — RATE_LIMITED', () => {
    it('identifies 429 as rate limited', () => {
      const result = RefreshTokenAnalyzer.analyzeHttpError({ status: 429, message: 'Too Many Requests' });
      expect(result.errorType).toBe(RefreshTokenErrorType.RATE_LIMITED);
      expect(result.isRecoverable).toBe(true);
      expect(result.shouldClearSession).toBe(false);
    });

    it('has higher maxRetries and longer backoff for rate limiting', () => {
      const result = RefreshTokenAnalyzer.analyzeHttpError({ status: 429, message: '' });
      expect(result.retryStrategy.maxRetries).toBeGreaterThanOrEqual(5);
      expect(result.retryStrategy.backoffMs).toBeGreaterThanOrEqual(5000);
    });
  });

  describe('5xx — SERVER_ERROR', () => {
    it.each([500, 502, 503, 599])('identifies %d as server error', (status) => {
      const result = RefreshTokenAnalyzer.analyzeHttpError({ status, message: 'Server Error' });
      expect(result.errorType).toBe(RefreshTokenErrorType.SERVER_ERROR);
      expect(result.isRecoverable).toBe(true);
      expect(result.shouldClearSession).toBe(false);
    });
  });

  describe('Network errors (by error code)', () => {
    it.each(['ECONNREFUSED', 'ENOTFOUND', 'ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED'])(
      'identifies %s code as network error',
      (code) => {
        const result = RefreshTokenAnalyzer.analyzeHttpError({ status: 0, message: '', code });
        expect(result.errorType).toBe(RefreshTokenErrorType.NETWORK_ERROR);
        expect(result.isRecoverable).toBe(true);
      },
    );
  });

  describe('Network errors (by message pattern)', () => {
    it.each([
      'network error occurred',
      'request timeout exceeded',
      'connection has failed',
    ])('identifies "%s" message as network error', (message) => {
      const result = RefreshTokenAnalyzer.analyzeHttpError({ status: 0, message });
      expect(result.errorType).toBe(RefreshTokenErrorType.NETWORK_ERROR);
    });
  });

  describe('Unknown errors', () => {
    it('classifies unrecognized status as unknown error', () => {
      const result = RefreshTokenAnalyzer.analyzeHttpError({ status: 418, message: "I'm a teapot" });
      expect(result.errorType).toBe(RefreshTokenErrorType.UNKNOWN_ERROR);
      expect(result.isRecoverable).toBe(false);
      expect(result.shouldClearSession).toBe(false);
    });

    it('preserves the message for unknown errors', () => {
      const result = RefreshTokenAnalyzer.analyzeHttpError({ status: 418, message: 'Custom message' });
      expect(result.message).toBe('Custom message');
    });

    it('uses status 0 when status is falsy', () => {
      const result = RefreshTokenAnalyzer.analyzeHttpError({ status: 0, message: 'Something weird' });
      expect(result.httpStatus).toBe(0);
    });
  });
});

describe('RefreshTokenAnalyzer.getUserFriendlyMessage', () => {
  const cases: [RefreshTokenErrorType, RegExp][] = [
    [RefreshTokenErrorType.TOKEN_EXPIRED, /expired/i],
    [RefreshTokenErrorType.TOKEN_INVALID, /invalid/i],
    [RefreshTokenErrorType.RATE_LIMITED, /many requests|later/i],
    [RefreshTokenErrorType.SERVER_ERROR, /server|unavailable/i],
    [RefreshTokenErrorType.NETWORK_ERROR, /network|connection/i],
    [RefreshTokenErrorType.UNKNOWN_ERROR, /unknown/i],
  ];

  it.each(cases)('returns message for %s', (errorType, pattern) => {
    const analysis = RefreshTokenAnalyzer.analyzeHttpError({ status: 0, message: '' });
    // Override errorType to test message mapping
    const msg = RefreshTokenAnalyzer.getUserFriendlyMessage({ ...analysis, errorType });
    expect(msg).toMatch(pattern);
  });
});

describe('RefreshTokenAnalyzer.shouldStopRetrying', () => {
  it('stops when retryStrategy.shouldRetry is false', () => {
    const analysis = RefreshTokenAnalyzer.analyzeHttpError({ status: 403, message: '' });
    expect(RefreshTokenAnalyzer.shouldStopRetrying(analysis, 0)).toBe(true);
  });

  it('stops when currentRetryCount >= maxRetries', () => {
    const analysis = RefreshTokenAnalyzer.analyzeHttpError({ status: 401, message: '' });
    const max = analysis.retryStrategy.maxRetries;
    expect(RefreshTokenAnalyzer.shouldStopRetrying(analysis, max)).toBe(true);
    expect(RefreshTokenAnalyzer.shouldStopRetrying(analysis, max + 1)).toBe(true);
  });

  it('does not stop below maxRetries', () => {
    const analysis = RefreshTokenAnalyzer.analyzeHttpError({ status: 401, message: '' });
    expect(RefreshTokenAnalyzer.shouldStopRetrying(analysis, 0)).toBe(false);
  });
});

describe('RefreshTokenAnalyzer.calculateBackoffDelay', () => {
  it('returns base delay for retry count 0', () => {
    const analysis = RefreshTokenAnalyzer.analyzeHttpError({ status: 429, message: '' });
    const delay = RefreshTokenAnalyzer.calculateBackoffDelay(analysis, 0);
    expect(delay).toBe(analysis.retryStrategy.backoffMs);
  });

  it('applies exponential backoff for higher retry counts', () => {
    const analysis = RefreshTokenAnalyzer.analyzeHttpError({ status: 429, message: '' });
    const delay0 = RefreshTokenAnalyzer.calculateBackoffDelay(analysis, 0);
    const delay1 = RefreshTokenAnalyzer.calculateBackoffDelay(analysis, 1);
    expect(delay1).toBeGreaterThan(delay0);
  });

  it('returns 0 for non-retryable errors', () => {
    const analysis = RefreshTokenAnalyzer.analyzeHttpError({ status: 403, message: '' });
    const delay = RefreshTokenAnalyzer.calculateBackoffDelay(analysis, 0);
    expect(delay).toBe(0);
  });
});
