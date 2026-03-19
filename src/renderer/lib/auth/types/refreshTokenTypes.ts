// src/renderer/lib/auth/types/refreshTokenTypes.ts

/**
 * Precise error classification - six error types based on HTTP status codes
 */
export enum RefreshTokenErrorType {
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',           // 401 - token expired but refreshable
  TOKEN_INVALID = 'TOKEN_INVALID',           // 403 - token invalid, cannot refresh
  RATE_LIMITED = 'RATE_LIMITED',             // 429 - rate limited
  SERVER_ERROR = 'SERVER_ERROR',             // 5xx - server error
  NETWORK_ERROR = 'NETWORK_ERROR',           // network connection issue
  UNKNOWN_ERROR = 'UNKNOWN_ERROR'            // other unknown errors
}

/**
 * HTTP error information interface
 */
export interface HttpErrorInfo {
  status: number;
  message: string;
  code?: string | null;
}

/**
 * Smart retry strategy configuration
 */
export interface RetryStrategy {
  shouldRetry: boolean;
  retryAfterMs: number;
  maxRetries: number;
  backoffMultiplier: number;
}

/**
 * Refresh token error analysis result
 */
export interface RefreshTokenErrorAnalysis {
  errorType: RefreshTokenErrorType;
  isRecoverable: boolean;
  shouldClearSession: boolean;
  retryStrategy: RetryStrategy;
  httpStatus?: number;
  message?: string;
}

/**
 * Token validation result
 */
export interface TokenValidationResult {
  isValid: boolean;
  errorType?: RefreshTokenErrorType | null;
  httpStatus?: number;
  isRecoverable?: boolean;
  message?: string;
}

/**
 * Authentication error type (for reporting to upper-layer components)
 */
export interface AuthError {
  type: RefreshTokenErrorType;
  message: string;
  isRecoverable: boolean;
  requiresUserAction: boolean;
  retryAfter?: number;
}

/**
 * Network error identification rules
 */
export interface NetworkErrorPattern {
  code?: string;
  messagePattern?: RegExp;
  description: string;
}

/**
 * Error analysis context information
 */
export interface ErrorAnalysisContext {
  operation: string;
  timestamp: number;
  sessionId?: string;
  userId?: string;
  attemptNumber?: number;
}