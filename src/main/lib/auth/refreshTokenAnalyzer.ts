// src/main/lib/auth/refreshTokenAnalyzer.ts
import { RefreshTokenErrorType, HttpErrorInfo, RefreshTokenErrorAnalysis, RetryStrategy, NetworkErrorPattern } from './types/refreshTokenTypes';

/**
 * Core error analysis engine - Precise HTTP status code error analysis system
 * 
 * This class implements six error type analyses based on HTTP status codes,
 * solving the core problem of the original system being unable to distinguish
 * between actual token failures and network errors.
 */
export class RefreshTokenAnalyzer {
  
  /**
   * Network error identification patterns
   */
  private static readonly NETWORK_ERROR_PATTERNS: NetworkErrorPattern[] = [
    { code: 'ECONNREFUSED', description: 'Connection refused' },
    { code: 'ENOTFOUND', description: 'DNS lookup failed' },
    { code: 'ECONNRESET', description: 'Connection reset' },
    { code: 'ETIMEDOUT', description: 'Request timeout' },
    { code: 'ECONNABORTED', description: 'Connection aborted' },
    { messagePattern: /network error/i, description: 'Generic network error' },
    { messagePattern: /timeout/i, description: 'Request timeout' },
    { messagePattern: /connection.*failed/i, description: 'Connection failure' }
  ];

  /**
   * Precise error determination based on HTTP status codes
   * 
   * This is the core of the fix - replacing the original coarse judgment based on retry count
   * with precise error type identification using HTTP status codes.
   */
  public static analyzeHttpError(error: HttpErrorInfo): RefreshTokenErrorAnalysis {
    const { status, message, code } = error;
    
    // 401: Token expired but may be refreshable
    if (status === 401) {
      return {
        errorType: RefreshTokenErrorType.TOKEN_EXPIRED,
        isRecoverable: true,
        shouldClearSession: false,
        retryStrategy: this.determineRetryStrategy(RefreshTokenErrorType.TOKEN_EXPIRED),
        httpStatus: status,
        message: 'Token expired but may be refreshable'
      };
    }
    
    // 403: Token invalid or insufficient permissions
    if (status === 403) {
      return {
        errorType: RefreshTokenErrorType.TOKEN_INVALID,
        isRecoverable: false,
        shouldClearSession: true,
        retryStrategy: this.determineRetryStrategy(RefreshTokenErrorType.TOKEN_INVALID),
        httpStatus: status,
        message: 'Token is invalid or insufficient permissions'
      };
    }
    
    // 429: Rate limited
    if (status === 429) {
      return {
        errorType: RefreshTokenErrorType.RATE_LIMITED,
        isRecoverable: true,
        shouldClearSession: false,
        retryStrategy: this.determineRetryStrategy(RefreshTokenErrorType.RATE_LIMITED),
        httpStatus: status,
        message: 'Rate limited, should retry with backoff'
      };
    }
    
    // 5xx: Server error
    if (status >= 500 && status < 600) {
      return {
        errorType: RefreshTokenErrorType.SERVER_ERROR,
        isRecoverable: true,
        shouldClearSession: false,
        retryStrategy: this.determineRetryStrategy(RefreshTokenErrorType.SERVER_ERROR),
        httpStatus: status,
        message: 'Server error, retry may succeed'
      };
    }
    
    // Network error detection
    if (this.isNetworkError(code, message)) {
      return {
        errorType: RefreshTokenErrorType.NETWORK_ERROR,
        isRecoverable: true,
        shouldClearSession: false,
        retryStrategy: this.determineRetryStrategy(RefreshTokenErrorType.NETWORK_ERROR),
        httpStatus: status || 0,
        message: 'Network connectivity issue'
      };
    }
    
    // Other unknown errors - handled conservatively
    return {
      errorType: RefreshTokenErrorType.UNKNOWN_ERROR,
      isRecoverable: false,
      shouldClearSession: false,
      retryStrategy: this.determineRetryStrategy(RefreshTokenErrorType.UNKNOWN_ERROR),
      httpStatus: status || 0,
      message: message || 'Unknown error occurred'
    };
  }

  /**
   * Network error detection
   */
  private static isNetworkError(code?: string | null, message?: string): boolean {
    if (code) {
      return this.NETWORK_ERROR_PATTERNS.some(pattern => 
        pattern.code === code
      );
    }
    
    if (message) {
      return this.NETWORK_ERROR_PATTERNS.some(pattern =>
        pattern.messagePattern && pattern.messagePattern.test(message)
      );
    }
    
    return false;
  }

  /**
   * Determine retry strategy
   */
  private static determineRetryStrategy(errorType: RefreshTokenErrorType): RetryStrategy {
    switch (errorType) {
      case RefreshTokenErrorType.TOKEN_EXPIRED:
        return {
          shouldRetry: true,
          maxRetries: 3,
          backoffMs: 1000,
          backoffMultiplier: 2.0
        };
      
      case RefreshTokenErrorType.RATE_LIMITED:
        return {
          shouldRetry: true,
          maxRetries: 5,
          backoffMs: 5000,
          backoffMultiplier: 2.0
        };
      
      case RefreshTokenErrorType.SERVER_ERROR:
        return {
          shouldRetry: true,
          maxRetries: 3,
          backoffMs: 2000,
          backoffMultiplier: 1.5
        };
      
      case RefreshTokenErrorType.NETWORK_ERROR:
        return {
          shouldRetry: true,
          maxRetries: 5,
          backoffMs: 1000,
          backoffMultiplier: 1.5
        };
      
      case RefreshTokenErrorType.TOKEN_INVALID:
        return {
          shouldRetry: false,
          maxRetries: 0,
          backoffMs: 0,
          backoffMultiplier: 1.0
        };
      
      default:
        return {
          shouldRetry: false,
          maxRetries: 0,
          backoffMs: 0,
          backoffMultiplier: 1.0
        };
    }
  }

  /**
   * Get user-friendly error message
   */
  public static getUserFriendlyMessage(analysis: RefreshTokenErrorAnalysis): string {
    switch (analysis.errorType) {
      case RefreshTokenErrorType.TOKEN_EXPIRED:
        return 'Authentication expired, attempting to refresh...';
      
      case RefreshTokenErrorType.TOKEN_INVALID:
        return 'Authentication invalid, please log in again';
      
      case RefreshTokenErrorType.RATE_LIMITED:
        return 'Too many requests, please try again later';
      
      case RefreshTokenErrorType.SERVER_ERROR:
        return 'Server temporarily unavailable, retrying...';
      
      case RefreshTokenErrorType.NETWORK_ERROR:
        return 'Network connection error, retrying...';
      
      default:
        return 'Unknown error occurred during authentication';
    }
  }

  /**
   * Check if retrying should stop immediately
   */
  public static shouldStopRetrying(analysis: RefreshTokenErrorAnalysis, currentRetryCount: number): boolean {
    if (!analysis.retryStrategy.shouldRetry) {
      return true;
    }
    
    return currentRetryCount >= analysis.retryStrategy.maxRetries;
  }

  /**
   * Calculate next retry backoff delay
   */
  public static calculateBackoffDelay(analysis: RefreshTokenErrorAnalysis, retryCount: number): number {
    const { backoffMs, backoffMultiplier } = analysis.retryStrategy;
    return Math.floor(backoffMs * Math.pow(backoffMultiplier, retryCount));
  }
}