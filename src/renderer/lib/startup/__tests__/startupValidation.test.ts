/** @vitest-environment happy-dom */

/**
 * startupValidation unit tests
 *
 * Mocks window.electronAPI.auth to control AuthManagerProxy behavior
 * (AuthManagerProxy is a thin IPC proxy — no need to mock the class itself)
 */

import {
  validateLocalStorageSession,
  validateLocalProfiles,
  validateRefreshToken,
  performTwoStageValidation,
} from '../startupValidation';
import { ValidationStatus, StartupAction } from '../../../types/startupValidationTypes';

describe('startupValidation', () => {
  let mockStorage: Record<string, string>;

  beforeEach(() => {
    mockStorage = {};
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: vi.fn((key: string) => mockStorage[key] ?? null),
        setItem: vi.fn((key: string, val: string) => { mockStorage[key] = val; }),
        removeItem: vi.fn((key: string) => { delete mockStorage[key]; }),
        clear: vi.fn(() => { mockStorage = {}; }),
      },
      writable: true,
      configurable: true,
    });

    // Default: auth API available, getCurrentAuth returns data, refreshCopilotToken succeeds
    (window as any).electronAPI = {
      auth: {
        getCurrentAuth: vi.fn().mockResolvedValue({ success: true, data: { ghcAuth: { user: { login: 'alice' }, alias: 'alice' } } }),
        refreshCopilotToken: vi.fn().mockResolvedValue({ success: true, data: { success: true, token: 'new-token' } }),
        getLocalActiveAuths: vi.fn().mockResolvedValue({ success: true, data: [] }),
      },
    };
  });

  afterEach(() => {
    delete (window as any).electronAPI;
  });

  // ─── validateLocalStorageSession ───
  describe('validateLocalStorageSession', () => {
    it('should return FAILED when no session in localStorage', async () => {
      const result = await validateLocalStorageSession();
      expect(result.status).toBe(ValidationStatus.FAILED);
      expect(result.hasLocalStorageSession).toBe(false);
      expect(result.sessionValid).toBe(false);
    });

    it('should return FAILED when session is malformed JSON', async () => {
      mockStorage['ghcSession'] = 'not-json{{{';
      const result = await validateLocalStorageSession();
      expect(result.status).toBe(ValidationStatus.FAILED);
      expect(result.hasLocalStorageSession).toBe(true);
      expect(result.error).toBe('Invalid session data format');
    });

    it('should return FAILED when session is missing required fields', async () => {
      mockStorage['ghcSession'] = JSON.stringify({ user: 'alice' });
      const result = await validateLocalStorageSession();
      expect(result.status).toBe(ValidationStatus.FAILED);
      expect(result.error).toBe('Incomplete session data');
    });

    it('should return SUCCESS when token is not expired', async () => {
      mockStorage['ghcSession'] = JSON.stringify({
        user: 'alice',
        refreshToken: 'rt-123',
        expiresAt: Date.now() + 60000,
      });
      const result = await validateLocalStorageSession();
      expect(result.status).toBe(ValidationStatus.SUCCESS);
      expect(result.sessionValid).toBe(true);
    });

    it('should return SUCCESS when token is expired but refresh succeeds', async () => {
      mockStorage['ghcSession'] = JSON.stringify({
        user: 'alice',
        refreshToken: 'rt-123',
        expiresAt: Date.now() - 1000,
      });
      (window as any).electronAPI.auth.refreshCopilotToken.mockResolvedValue({ success: true, data: { success: true } });

      const result = await validateLocalStorageSession();
      expect(result.status).toBe(ValidationStatus.SUCCESS);
      expect(result.sessionValid).toBe(true);
      expect(result.refreshTokenValid).toBe(true);
    });

    it('should return FAILED when token is expired and refresh fails', async () => {
      mockStorage['ghcSession'] = JSON.stringify({
        user: 'alice',
        refreshToken: 'rt-123',
        expiresAt: Date.now() - 1000,
      });
      (window as any).electronAPI.auth.refreshCopilotToken.mockResolvedValue({ success: false });

      const result = await validateLocalStorageSession();
      expect(result.status).toBe(ValidationStatus.FAILED);
      expect(result.sessionValid).toBe(false);
      expect(result.refreshTokenValid).toBe(false);
    });

    it('should return ERROR when localStorage.getItem throws an exception', async () => {
      Object.defineProperty(globalThis, 'localStorage', {
        value: {
          getItem: vi.fn(() => { throw new Error('Storage access denied'); }),
        },
        writable: true,
        configurable: true,
      });
      const result = await validateLocalStorageSession();
      expect(result.status).toBe(ValidationStatus.ERROR);
      expect(result.error).toBe('Storage access denied');
    });
  });

  // ─── validateRefreshToken ───
  describe('validateRefreshToken', () => {
    it('should return true when refresh succeeds', async () => {
      const result = await validateRefreshToken('rt-123');
      expect(result).toBe(true);
    });

    it('should return false when getCurrentAuth returns no data', async () => {
      (window as any).electronAPI.auth.getCurrentAuth.mockResolvedValue({ success: false });

      const result = await validateRefreshToken('rt-123');
      expect(result).toBe(false);
    });

    it('should return false when auth API is not available', async () => {
      (window as any).electronAPI = {};
      const result = await validateRefreshToken('rt-123');
      expect(result).toBe(false);
    });
  });

  // ─── validateLocalProfiles ───
  describe('validateLocalProfiles', () => {
    it('should return SUCCESS with 0 profiles when AuthManager returns empty', async () => {
      (window as any).electronAPI.auth.getLocalActiveAuths.mockResolvedValue({ success: true, data: [] });

      const result = await validateLocalProfiles();
      expect(result.status).toBe(ValidationStatus.SUCCESS);
      expect(result.totalProfiles).toBe(0);
      expect(result.validUsers).toHaveLength(0);
      expect(result.authManagerInitialized).toBe(true);
    });

    it('should return SUCCESS with valid users when profiles exist', async () => {
      (window as any).electronAPI.auth.getLocalActiveAuths.mockResolvedValue({
        success: true,
        data: [
          { ghcAuth: { user: { login: 'alice' }, alias: 'alice-alias' } },
          { ghcAuth: { user: { login: 'bob' }, alias: 'bob-alias' } },
        ],
      });

      const result = await validateLocalProfiles();
      expect(result.status).toBe(ValidationStatus.SUCCESS);
      expect(result.totalProfiles).toBe(2);
      expect(result.validUsers).toHaveLength(2);
      expect(result.validUsers[0].alias).toBe('alice-alias');
    });

    it('should return ERROR when auth API throws', async () => {
      (window as any).electronAPI.auth.getLocalActiveAuths.mockResolvedValue({ success: false, error: 'Failed' });

      const result = await validateLocalProfiles();
      expect(result.status).toBe(ValidationStatus.ERROR);
    });
  });

  // ─── performTwoStageValidation ───
  describe('performTwoStageValidation', () => {
    it('should return AUTO_LOGIN_SINGLE_USER when exactly 1 valid user', async () => {
      (window as any).electronAPI.auth.getLocalActiveAuths.mockResolvedValue({
        success: true,
        data: [{ ghcAuth: { user: { login: 'alice' }, alias: 'alice' } }],
      });

      const result = await performTwoStageValidation();
      expect(result.recommendedAction).toBe(StartupAction.AUTO_LOGIN_SINGLE_USER);
    });

    it('should return SHOW_USER_SELECTION when multiple valid users', async () => {
      (window as any).electronAPI.auth.getLocalActiveAuths.mockResolvedValue({
        success: true,
        data: [
          { ghcAuth: { user: { login: 'alice' }, alias: 'alice' } },
          { ghcAuth: { user: { login: 'bob' }, alias: 'bob' } },
        ],
      });

      const result = await performTwoStageValidation();
      expect(result.recommendedAction).toBe(StartupAction.SHOW_USER_SELECTION);
    });

    it('should return SHOW_NEW_USER_SIGNUP when no profiles', async () => {
      (window as any).electronAPI.auth.getLocalActiveAuths.mockResolvedValue({ success: true, data: [] });

      const result = await performTwoStageValidation();
      expect(result.recommendedAction).toBe(StartupAction.SHOW_NEW_USER_SIGNUP);
    });

    it('should return SHOW_ERROR when auth API fails', async () => {
      (window as any).electronAPI.auth.getLocalActiveAuths.mockResolvedValue({ success: false, error: 'Network error' });

      const result = await performTwoStageValidation();
      expect(result.recommendedAction).toBe(StartupAction.SHOW_ERROR);
    });

    it('should skip stage2 when skipStage2 option is set', async () => {
      const result = await performTwoStageValidation({ skipStage2: true });
      expect(result.stage2.authManagerInitialized).toBe(false);
      expect(result.recommendedAction).toBe(StartupAction.SHOW_NEW_USER_SIGNUP);
    });

    it('should return SHOW_ERROR when an unexpected exception is thrown during validation', async () => {
      // Force an exception in validateLocalProfiles by making getLocalActiveAuths throw
      (window as any).electronAPI.auth.getLocalActiveAuths.mockRejectedValue(new Error('Unexpected crash'));

      const result = await performTwoStageValidation();
      expect(result.recommendedAction).toBe(StartupAction.SHOW_ERROR);
    });
  });

  describe('validateLocalProfiles — inner exception path', () => {
    it('should return ERROR status when getLocalActiveAuths throws an exception', async () => {
      (window as any).electronAPI.auth.getLocalActiveAuths.mockRejectedValue(new Error('IPC channel broken'));

      const result = await validateLocalProfiles();
      expect(result.status).toBe(ValidationStatus.ERROR);
      expect(result.authManagerInitialized).toBe(false);
      expect(result.error).toBe('IPC channel broken');
    });
  });

  describe('validateRefreshToken — exception path', () => {
    it('should return false when refreshCopilotToken throws an exception', async () => {
      (window as any).electronAPI.auth.refreshCopilotToken.mockRejectedValue(new Error('Network failure'));

      const result = await validateRefreshToken('rt-123');
      expect(result).toBe(false);
    });
  });
});
