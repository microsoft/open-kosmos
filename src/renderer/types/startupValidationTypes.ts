// src/renderer/types/startupValidationTypes.ts
// Type definitions related to startup validation

import { AuthData } from './authTypes';

/**
 * Validation stage enumeration
 */
export enum ValidationStage {
  STAGE_1 = 'stage1',
  STAGE_2 = 'stage2'
}

/**
 * Validation status enumeration
 */
export enum ValidationStatus {
  SUCCESS = 'success',
  FAILED = 'failed',
  ERROR = 'error'
}

/**
 * Base interface for validation results
 */
export interface BaseValidationResult {
  status: ValidationStatus;
  stage: ValidationStage;
  timestamp: number;
  duration?: number;
  error?: string;
}

/**
 * Stage 1 validation result - localStorage session validation
 */
export interface Stage1ValidationResult extends BaseValidationResult {
  stage: ValidationStage.STAGE_1;
  hasLocalStorageSession: boolean;
  sessionValid: boolean;
  refreshTokenValid?: boolean;
  sessionData?: any;
}

/**
 * Stage 2 validation result - uses AuthData directly without mapping
 */
export interface Stage2ValidationResult extends BaseValidationResult {
  stage: ValidationStage.STAGE_2;
  totalProfiles: number;
  validUsers: Array<{
    authData: AuthData;
    alias: string;
    isValid: boolean;
    type: 'valid';
  }>;
  expiredUsers: Array<{
    authData: AuthData;
    alias: string;
    isExpired: boolean;
    isRecoverable: boolean;
    type: 'recoverable';
  }>;
  invalidUsers: Array<{
    alias: string;
    reason: string;
  }>;
  // AuthManager related fields
  authManagerInitialized: boolean;
  authManagerProfiles: Array<{
    authData: AuthData;
    alias: string;
    isValid?: boolean;
    isExpired?: boolean;
    isRecoverable?: boolean;
    type: 'valid' | 'recoverable' | 'invalid';
  }>;
  skippedDueToValidSession: boolean;
}

/**
 * Final result of startup validation
 */
export interface StartupValidationResult {
  stage1: Stage1ValidationResult;
  stage2: Stage2ValidationResult;
  recommendedAction: StartupAction;
  totalDuration: number;
  completedAt: number;
}

/**
 * Recommended startup actions
 */
export enum StartupAction {
  // Auto login single user - found exactly one valid user
  AUTO_LOGIN_SINGLE_USER = 'autoLoginSingleUser',

  // Show user selection page - has multiple valid users or expired users
  SHOW_USER_SELECTION = 'showUserSelection',

  // Show new user signup flow - no valid users
  SHOW_NEW_USER_SIGNUP = 'showNewUserSignup',

  // Show error page - error occurred during validation
  SHOW_ERROR = 'showError'
}

/**
 * Validation configuration options
 */
export interface ValidationOptions {
  skipStage2?: boolean;
  timeoutMs?: number;
  enableLogging?: boolean;
}