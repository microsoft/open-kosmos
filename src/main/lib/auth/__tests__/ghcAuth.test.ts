/**
 * Tests for GhcAuthManager (ghcAuth.ts)
 */

vi.mock('../../unifiedLogger', async () => import('../../__mocks__/unifiedLogger'));

vi.mock('../ghcConfig', () => ({
  GHC_CONFIG: {
    CLIENT_ID: 'test-client-id',
    DEVICE_CODE_URL: 'https://github.com/login/device/code',
    ACCESS_TOKEN_URL: 'https://github.com/login/oauth/access_token',
    COPILOT_TOKEN_URL: 'https://api.github.com/copilot_internal/v2/token',
  },
}));

vi.mock('../aliasUtils', () => ({
  aliasToAadAccount: vi.fn((login: string) => `${login}@github.com`),
}));

// We need to import after mocks are set up
import { GhcAuthManager } from '../ghcAuth';

// Helper to mock fetch with a JSON response
function mockFetch(data: any, status = 200, statusText = 'OK') {
  const ok = status >= 200 && status < 300;
  return vi.fn().mockResolvedValue({
    ok,
    status,
    statusText,
    json: vi.fn().mockResolvedValue(data),
  });
}

describe('GhcAuthManager', () => {
  let manager: GhcAuthManager;
  const originalFetch = global.fetch;

  beforeEach(() => {
    GhcAuthManager.resetInstance();
    manager = new GhcAuthManager();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // ── Singleton ──────────────────────────────────────────────────────────────

  describe('getInstance / singleton', () => {
    it('returns the same instance on repeated calls', () => {
      GhcAuthManager.resetInstance();
      const a = GhcAuthManager.getInstance();
      const b = GhcAuthManager.getInstance();
      expect(a).toBe(b);
    });

    it('resetInstance creates a fresh instance', () => {
      const a = GhcAuthManager.getInstance();
      GhcAuthManager.resetInstance();
      const b = GhcAuthManager.getInstance();
      expect(a).not.toBe(b);
    });
  });

  // ── refreshCopilotToken ────────────────────────────────────────────────────

  describe('refreshCopilotToken', () => {
    it('returns token data on success', async () => {
      const expiresAt = new Date(Date.now() + 3600_000).toISOString();
      global.fetch = mockFetch({ token: 'cplt-abc', expires_at: expiresAt });

      const result = await manager.refreshCopilotToken('gh-token-123');

      expect(result.token).toBe('cplt-abc');
      expect(result.expires_at).toBe(expiresAt);
      expect(result.api_url).toBeTruthy();
      expect(result.timestamp).toBeTruthy();
    });

    it('uses api_url and timestamp from response when present', async () => {
      const expiresAt = new Date(Date.now() + 3600_000).toISOString();
      global.fetch = mockFetch({
        token: 'cplt-xyz',
        expires_at: expiresAt,
        api_url: 'https://custom.api.url',
        timestamp: '2024-01-01T00:00:00.000Z',
      });

      const result = await manager.refreshCopilotToken('gh-token');
      expect(result.api_url).toBe('https://custom.api.url');
      expect(result.timestamp).toBe('2024-01-01T00:00:00.000Z');
    });

    it('throws when response is missing token field', async () => {
      global.fetch = mockFetch({ expires_at: '2099-01-01T00:00:00Z' });

      await expect(manager.refreshCopilotToken('gh-token')).rejects.toThrow(
        'Missing required fields',
      );
    });

    it('throws when response is missing expires_at field', async () => {
      global.fetch = mockFetch({ token: 'cplt-abc' });

      await expect(manager.refreshCopilotToken('gh-token')).rejects.toThrow(
        'Missing required fields',
      );
    });

    it('throws on non-retryable HTTP 401', async () => {
      global.fetch = mockFetch({}, 401, 'Unauthorized');

      await expect(manager.refreshCopilotToken('gh-token', 3)).rejects.toThrow();
    });

    it('throws on fetch network error (non-retryable path)', async () => {
      global.fetch = vi.fn().mockRejectedValue(
        Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' }),
      );

      await expect(manager.refreshCopilotToken('gh-token', 3)).rejects.toThrow();
    });
  });

  // ── validateGitHubToken ────────────────────────────────────────────────────

  describe('validateGitHubToken', () => {
    it('returns valid=true when token has copilot access', async () => {
      global.fetch = mockFetch({ token: 'cplt-ok' });

      const result = await manager.validateGitHubToken('good-gh-token');
      expect(result.valid).toBe(true);
      expect(result.expired).toBe(false);
    });

    it('returns valid=false when token response has no token field', async () => {
      global.fetch = mockFetch({});

      const result = await manager.validateGitHubToken('no-copilot-token');
      expect(result.valid).toBe(false);
    });

    it('returns expired=true on HTTP 401', async () => {
      global.fetch = mockFetch({}, 401, 'Unauthorized');

      const result = await manager.validateGitHubToken('expired-token');
      expect(result.valid).toBe(false);
      expect(result.expired).toBe(true);
      expect(result.error).toMatch(/expired/i);
    });

    it('returns expired=true on HTTP 403', async () => {
      global.fetch = mockFetch({}, 403, 'Forbidden');

      const result = await manager.validateGitHubToken('no-perm-token');
      expect(result.valid).toBe(false);
      expect(result.expired).toBe(true);
      expect(result.error).toMatch(/Copilot permissions/i);
    });

    it('returns error string on other HTTP errors', async () => {
      global.fetch = mockFetch({}, 500, 'Internal Server Error');

      const result = await manager.validateGitHubToken('token');
      expect(result.valid).toBe(false);
      expect(result.expired).toBe(false);
      expect(result.error).toMatch(/500/);
    });

    it('returns error string on network failure', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network down'));

      const result = await manager.validateGitHubToken('token');
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/Network down/);
    });
  });

  // ── getUserInfo ────────────────────────────────────────────────────────────

  describe('getUserInfo', () => {
    it('returns user data on success', async () => {
      global.fetch = mockFetch({
        id: 42,
        login: 'octocat',
        name: 'The Octocat',
        email: 'octocat@github.com',
        avatar_url: 'https://github.com/avatar.png',
      });

      const user = await manager.getUserInfo('access-token');
      expect(user).not.toBeNull();
      expect(user!.login).toBe('octocat');
      expect(user!.name).toBe('The Octocat');
      expect(user!.email).toBe('octocat@github.com');
      expect(user!.avatarUrl).toBe('https://github.com/avatar.png');
      expect(user!.copilotPlan).toBe('individual');
    });

    it('falls back login to name when name is absent', async () => {
      global.fetch = mockFetch({ id: 1, login: 'noname', name: null });

      const user = await manager.getUserInfo('token');
      expect(user!.name).toBe('noname');
    });

    it('returns null on HTTP error', async () => {
      global.fetch = mockFetch({}, 403, 'Forbidden');

      const user = await manager.getUserInfo('bad-token');
      expect(user).toBeNull();
    });

    it('returns null on network failure', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('fetch failed'));

      const user = await manager.getUserInfo('token');
      expect(user).toBeNull();
    });
  });

  // ── startDeviceFlow ────────────────────────────────────────────────────────

  describe('startDeviceFlow', () => {
    it('returns device code response on success', async () => {
      global.fetch = mockFetch({
        device_code: 'dc-abc',
        user_code: 'ABCD-1234',
        verification_uri: 'https://github.com/login/device',
        expires_in: 900,
        interval: 5,
      });

      const result = await manager.startDeviceFlow();
      expect(result.device_code).toBe('dc-abc');
      expect(result.user_code).toBe('ABCD-1234');
      expect(result.verification_uri).toBe('https://github.com/login/device');
    });

    it('uses default expires_in and interval when absent', async () => {
      global.fetch = mockFetch({
        device_code: 'dc',
        user_code: 'UC',
        verification_uri: 'https://github.com/login/device',
      });

      const result = await manager.startDeviceFlow();
      expect(result.expires_in).toBe(900);
      expect(result.interval).toBe(5);
    });

    it('throws on missing required fields', async () => {
      global.fetch = mockFetch({ device_code: 'dc' }); // missing user_code + verification_uri

      await expect(manager.startDeviceFlow()).rejects.toThrow(
        'Invalid device code response',
      );
    });

    it('throws on HTTP error', async () => {
      global.fetch = mockFetch({}, 500, 'Server Error');

      await expect(manager.startDeviceFlow()).rejects.toThrow('Device code request failed');
    });
  });

  // ── pollForAccessToken ─────────────────────────────────────────────────────

  describe('pollForAccessToken', () => {
    it('returns authorization_pending while waiting', async () => {
      global.fetch = mockFetch({ error: 'authorization_pending' });

      const result = await manager.pollForAccessToken('dc-code');
      expect(result.success).toBe(false);
      expect(result.error).toBe('authorization_pending');
    });

    it('returns slow_down with newInterval from server', async () => {
      global.fetch = mockFetch({ error: 'slow_down', interval: 15 });

      const result = await manager.pollForAccessToken('dc-code', 5);
      expect(result.success).toBe(false);
      expect(result.error).toBe('slow_down');
      expect(result.newInterval).toBe(15);
    });

    it('returns slow_down with fallback interval when server omits it', async () => {
      global.fetch = mockFetch({ error: 'slow_down' });

      const result = await manager.pollForAccessToken('dc-code', 5);
      expect(result.success).toBe(false);
      expect(result.error).toBe('slow_down');
      expect(result.newInterval).toBe(10); // 5 + 5
    });

    it('returns expired_token error', async () => {
      global.fetch = mockFetch({ error: 'expired_token' });

      const result = await manager.pollForAccessToken('dc-code');
      expect(result.success).toBe(false);
      expect(result.error).toBe('expired_token');
    });

    it('returns access_denied error', async () => {
      global.fetch = mockFetch({ error: 'access_denied' });

      const result = await manager.pollForAccessToken('dc-code');
      expect(result.success).toBe(false);
      expect(result.error).toBe('access_denied');
    });

    it('returns error on missing access_token', async () => {
      global.fetch = mockFetch({});

      const result = await manager.pollForAccessToken('dc-code');
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/No access token/);
    });
  });

  // ── clearSession ──────────────────────────────────────────────────────────

  describe('clearSession', () => {
    it('returns success=true for any user alias', async () => {
      const result = await manager.clearSession('someuser');
      expect(result.success).toBe(true);
    });
  });
});
