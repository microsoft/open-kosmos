import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  extractCopilotToken,
  extractGitHubToken,
  extractUser,
  isCopilotTokenExpired,
  isGitHubTokenExpired,
  getCopilotTokenRemainingTime,
  getGitHubTokenRemainingTime,
  isAuthDataValid,
  createEmptyAuthData,
} from '../authDataAdapter';
import { AuthData } from '../../../types/authTypes';

function makeAuthData(overrides: Partial<AuthData['ghcAuth']> = {}): AuthData {
  const now = new Date().toISOString();
  const futureExpiry = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
  return {
    version: '3.0.0',
    createdAt: now,
    updatedAt: now,
    authProvider: 'ghc',
    ghcAuth: {
      alias: 'testuser',
      user: {
        id: 'u1',
        login: 'testuser',
        email: 'test@example.com',
        name: 'Test User',
        avatarUrl: 'https://example.com/avatar.png',
        copilotPlan: 'individual',
      },
      gitHubTokens: {
        timestamp: now,
        api_url: 'https://github.com/login/oauth/access_token',
        access_token: 'ghs_token123',
        token_type: 'bearer',
        scope: 'read:user',
      },
      copilotTokens: {
        timestamp: now,
        api_url: 'https://api.github.com/copilot_internal/v2/token',
        expires_at: futureExpiry,
        token: 'cop_token456',
      },
      capabilities: [],
      ...overrides,
    },
  };
}

describe('authDataAdapter', () => {
  describe('extractCopilotToken', () => {
    it('returns the copilot token when authData is valid', () => {
      expect(extractCopilotToken(makeAuthData())).toBe('cop_token456');
    });

    it('returns null when authData is null', () => {
      expect(extractCopilotToken(null)).toBeNull();
    });
  });

  describe('extractGitHubToken', () => {
    it('returns the github access_token when authData is valid', () => {
      expect(extractGitHubToken(makeAuthData())).toBe('ghs_token123');
    });

    it('returns null when authData is null', () => {
      expect(extractGitHubToken(null)).toBeNull();
    });
  });

  describe('extractUser', () => {
    it('returns the user object', () => {
      const user = extractUser(makeAuthData());
      expect(user?.login).toBe('testuser');
    });

    it('returns null for null authData', () => {
      expect(extractUser(null)).toBeNull();
    });
  });

  describe('isCopilotTokenExpired', () => {
    it('returns true for null authData', () => {
      expect(isCopilotTokenExpired(null)).toBe(true);
    });

    it('returns false when expires_at is in the future', () => {
      expect(isCopilotTokenExpired(makeAuthData())).toBe(false);
    });

    it('returns true when expires_at is in the past', () => {
      const past = Math.floor(Date.now() / 1000) - 3600;
      const data = makeAuthData({ copilotTokens: { timestamp: '', api_url: '', expires_at: past, token: 'x' } });
      expect(isCopilotTokenExpired(data)).toBe(true);
    });
  });

  describe('isGitHubTokenExpired', () => {
    it('returns true for null authData', () => {
      expect(isGitHubTokenExpired(null)).toBe(true);
    });

    it('returns false when access_token is present', () => {
      expect(isGitHubTokenExpired(makeAuthData())).toBe(false);
    });

    it('returns true when access_token is empty', () => {
      const data = makeAuthData({
        gitHubTokens: { timestamp: '', api_url: '', access_token: '', token_type: 'bearer', scope: '' },
      });
      expect(isGitHubTokenExpired(data)).toBe(true);
    });
  });

  describe('getCopilotTokenRemainingTime', () => {
    it('returns 0 for null authData', () => {
      expect(getCopilotTokenRemainingTime(null)).toBe(0);
    });

    it('returns a positive number for a future expiry', () => {
      expect(getCopilotTokenRemainingTime(makeAuthData())).toBeGreaterThan(0);
    });

    it('returns 0 for an expired token', () => {
      const past = Math.floor(Date.now() / 1000) - 3600;
      const data = makeAuthData({ copilotTokens: { timestamp: '', api_url: '', expires_at: past, token: 'x' } });
      expect(getCopilotTokenRemainingTime(data)).toBe(0);
    });
  });

  describe('getGitHubTokenRemainingTime', () => {
    it('returns 0 for null authData', () => {
      expect(getGitHubTokenRemainingTime(null)).toBe(0);
    });

    it('returns 0 when access_token is absent', () => {
      const data = makeAuthData({
        gitHubTokens: { timestamp: '', api_url: '', access_token: '', token_type: 'bearer', scope: '' },
      });
      expect(getGitHubTokenRemainingTime(data)).toBe(0);
    });

    it('returns 30 days in ms when token is present', () => {
      expect(getGitHubTokenRemainingTime(makeAuthData())).toBe(30 * 24 * 60 * 60 * 1000);
    });
  });

  describe('isAuthDataValid', () => {
    it('returns false for null', () => {
      expect(isAuthDataValid(null)).toBe(false);
    });

    it('returns true for a fully-populated authData', () => {
      expect(isAuthDataValid(makeAuthData())).toBe(true);
    });

    it('returns false when copilot token is missing', () => {
      const data = makeAuthData({ copilotTokens: { timestamp: '', api_url: '', expires_at: 0, token: '' } });
      expect(isAuthDataValid(data)).toBe(false);
    });

    it('returns false when github access_token is missing', () => {
      const data = makeAuthData({
        gitHubTokens: { timestamp: '', api_url: '', access_token: '', token_type: 'bearer', scope: '' },
      });
      expect(isAuthDataValid(data)).toBe(false);
    });
  });

  describe('createEmptyAuthData', () => {
    it('returns an object with version 3.0.0', () => {
      const empty = createEmptyAuthData();
      expect(empty.version).toBe('3.0.0');
    });

    it('returns object with empty tokens', () => {
      const empty = createEmptyAuthData();
      expect(empty.ghcAuth.gitHubTokens.access_token).toBe('');
      expect(empty.ghcAuth.copilotTokens.token).toBe('');
    });

    it('returns object with empty alias', () => {
      const empty = createEmptyAuthData();
      expect(empty.ghcAuth.alias).toBe('');
    });
  });
});
