// src/renderer/lib/auth/authDataAdapter.ts - AuthData utility functions (V3.0)
// Provides common operations and validation functions for AuthData

import { AuthData } from '../../types/authTypes';

/**
 * Extract Copilot Token from AuthData
 */
export function extractCopilotToken(authData: AuthData | null): string | null {
  return authData?.ghcAuth.copilotTokens.token || null;
}

/**
 * Extract GitHub Token from AuthData
 */
export function extractGitHubToken(authData: AuthData | null): string | null {
  return authData?.ghcAuth.gitHubTokens.access_token || null;
}

/**
 * Extract user info from AuthData
 */
export function extractUser(authData: AuthData | null): AuthData['ghcAuth']['user'] | null {
  return authData?.ghcAuth.user || null;
}

/**
 * Check if Copilot Token is expired (V3 - expires_at is a seconds-based timestamp)
 */
export function isCopilotTokenExpired(authData: AuthData | null): boolean {
  if (!authData) return true;
  const nowSeconds = Math.floor(Date.now() / 1000);
  return nowSeconds > authData.ghcAuth.copilotTokens.expires_at;
}

/**
 * Check if GitHub Token is expired (V3 - GitHub tokens have no expires field; they are long-lived)
 */
export function isGitHubTokenExpired(authData: AuthData | null): boolean {
  if (!authData) return true;
  // GitHub tokens have no expires field; we assume they are valid
  // Actual validation requires an API call
  return !authData.ghcAuth.gitHubTokens.access_token;
}

/**
 * Get Copilot Token remaining validity time in milliseconds (V3 - expires_at is a seconds-based timestamp)
 */
export function getCopilotTokenRemainingTime(authData: AuthData | null): number {
  if (!authData) return 0;
  const nowSeconds = Math.floor(Date.now() / 1000);
  const remainingSeconds = authData.ghcAuth.copilotTokens.expires_at - nowSeconds;
  return Math.max(0, remainingSeconds * 1000);
}

/**
 * Get GitHub Token remaining validity time in milliseconds (V3 - no expires field)
 * Returns a large value to indicate long-term validity
 */
export function getGitHubTokenRemainingTime(authData: AuthData | null): number {
  if (!authData || !authData.ghcAuth.gitHubTokens.access_token) return 0;
  // GitHub tokens are long-lived; return 30 days
  return 30 * 24 * 60 * 60 * 1000;
}

/**
 * Check if AuthData is valid (V3 format)
 */
export function isAuthDataValid(authData: AuthData | null): boolean {
  if (!authData) return false;

  // Check required fields
  if (!authData.ghcAuth ||
      !authData.ghcAuth.user ||
      !authData.ghcAuth.gitHubTokens ||
      !authData.ghcAuth.copilotTokens) {
    return false;
  }

  // Check that tokens exist
  if (!authData.ghcAuth.gitHubTokens.access_token ||
      !authData.ghcAuth.copilotTokens.token) {
    return false;
  }

  return true;
}

/**
 * Create an empty AuthData (for initialization) (V3 format)
 */
export function createEmptyAuthData(): AuthData {
  const now = new Date().toISOString();
  return {
    version: '3.0.0',
    createdAt: now,
    updatedAt: now,
    authProvider: 'ghc',
    ghcAuth: {
      alias: '',
      user: {
        id: '',
        login: '',
        email: '',
        name: '',
        avatarUrl: '',
        copilotPlan: 'individual'
      },
      gitHubTokens: {
        timestamp: now,
        api_url: 'https://github.com/login/oauth/access_token',
        access_token: '',
        token_type: 'bearer',
        scope: ''
      },
      copilotTokens: {
        timestamp: now,
        api_url: 'https://api.github.com/copilot_internal/v2/token',
        expires_at: 0,
        token: ''
      },
      capabilities: []
    }
  };
}