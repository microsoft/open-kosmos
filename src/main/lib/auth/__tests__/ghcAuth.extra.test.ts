/**
 * Extra coverage for GhcAuthManager — performDeviceFlowAuthentication,
 * pollForAccessToken success path, and ghcAuth import.
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

import { GhcAuthManager } from '../ghcAuth';

function mockFetch(data: any, status = 200, statusText = 'OK') {
  const ok = status >= 200 && status < 300;
  return vi.fn().mockResolvedValue({
    ok,
    status,
    statusText,
    json: vi.fn().mockResolvedValue(data),
  });
}

// Helper that sets up fetch to serve different responses in sequence
function mockFetchSequence(responses: Array<{ data: any; status?: number; statusText?: string }>) {
  let call = 0;
  return vi.fn().mockImplementation(() => {
    const res = responses[Math.min(call++, responses.length - 1)];
    const status = res.status ?? 200;
    const ok = status >= 200 && status < 300;
    return Promise.resolve({
      ok,
      status,
      statusText: res.statusText ?? 'OK',
      json: () => Promise.resolve(res.data),
    });
  });
}

describe('GhcAuthManager — extra coverage', () => {
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

  // ── pollForAccessToken: success path (getCompleteAuthData) ─────────────────

  describe('pollForAccessToken — success path', () => {
    it('returns authData when poll succeeds and complete auth data is fetched', async () => {
      // Fetch is called three times:
      //   1. poll  → access_token
      //   2. getUserInfo → user data
      //   3. getCopilotToken → copilot token
      global.fetch = mockFetchSequence([
        {
          data: {
            access_token: 'gh-tok-123',
            token_type: 'bearer',
            scope: 'read:user',
          },
        },
        {
          data: {
            id: 1,
            login: 'octocat',
            name: 'The Octocat',
            email: 'octocat@github.com',
            avatar_url: 'https://avatars.githubusercontent.com/u/1',
          },
        },
        {
          data: {
            token: 'cplt-xyz',
            expires_at: 9999999999,
          },
        },
      ]);

      const result = await manager.pollForAccessToken('device-code-abc');
      expect(result.success).toBe(true);
      expect(result.authData).toBeDefined();
      expect(result.authData!.ghcAuth.user.login).toBe('octocat');
      expect(result.authData!.ghcAuth.copilotTokens.token).toBe('cplt-xyz');
    });

    it('returns error when getUserInfo fails (getCompleteAuthData returns null)', async () => {
      // 1. poll → access token  2. getUserInfo → 403
      global.fetch = mockFetchSequence([
        {
          data: { access_token: 'gh-tok', token_type: 'bearer', scope: '' },
        },
        { data: {}, status: 403, statusText: 'Forbidden' },
      ]);

      const result = await manager.pollForAccessToken('dc');
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it('returns error when copilot token fetch fails inside getCompleteAuthData', async () => {
      global.fetch = mockFetchSequence([
        { data: { access_token: 'gh-tok', token_type: 'bearer', scope: '' } },
        { data: { id: 1, login: 'u', name: 'u', email: '', avatar_url: '' } },
        { data: {}, status: 500, statusText: 'Server Error' },
      ]);

      const result = await manager.pollForAccessToken('dc');
      expect(result.success).toBe(false);
    });

    it('returns error when oauth error is unknown (throws)', async () => {
      global.fetch = mockFetch({ error: 'some_unknown_error', error_description: 'weird' });
      const result = await manager.pollForAccessToken('dc');
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/OAuth error/);
    });
  });

  // ── performDeviceFlowAuthentication ───────────────────────────────────────
  // We use very short intervals (0.001s = 1ms) to exercise the polling loop
  // without needing fake timers.

  describe('performDeviceFlowAuthentication', () => {
    it('calls onError when startDeviceFlow fails', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('network down'));

      const onDeviceCode = vi.fn();
      const onError = vi.fn();
      const onSuccess = vi.fn();

      await manager.performDeviceFlowAuthentication(onDeviceCode, onError, onSuccess);

      expect(onDeviceCode).not.toHaveBeenCalled();
      expect(onError).toHaveBeenCalledWith(expect.stringContaining('network down'));
    });

    it('calls onSuccess after authorization completes (fast interval)', async () => {
      let fetchCall = 0;
      global.fetch = vi.fn().mockImplementation(() => {
        fetchCall++;
        if (fetchCall === 1) {
          // startDeviceFlow — 1ms interval so poll fires immediately
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                device_code: 'dc',
                user_code: 'UC12',
                verification_uri: 'https://github.com/login/device',
                expires_in: 900,
                interval: 0.001,
              }),
          });
        }
        if (fetchCall === 2) {
          // first poll → access token immediately
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({ access_token: 'gh-tok', token_type: 'bearer', scope: '' }),
          });
        }
        if (fetchCall === 3) {
          // getUserInfo
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({ id: 1, login: 'dev', name: 'Dev', email: '', avatar_url: '' }),
          });
        }
        // getCopilotToken
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ token: 'cplt', expires_at: 9999999999 }),
        });
      });

      const onDeviceCode = vi.fn();
      const onError = vi.fn();
      const onSuccess = vi.fn();

      // performDeviceFlowAuthentication schedules a setTimeout; wait for the whole chain
      await manager.performDeviceFlowAuthentication(onDeviceCode, onError, onSuccess);
      expect(onDeviceCode).toHaveBeenCalledWith(
        expect.objectContaining({ device_code: 'dc', user_code: 'UC12' }),
      );

      // Wait for the micro-interval poll to complete
      await new Promise<void>((resolve) => setTimeout(resolve, 50));

      expect(onSuccess).toHaveBeenCalledWith(
        expect.objectContaining({
          ghcAuth: expect.objectContaining({ user: expect.objectContaining({ login: 'dev' }) }),
        }),
      );
      expect(onError).not.toHaveBeenCalled();
    });

    it('calls onError when device code expires (max attempts reached)', async () => {
      let fetchCall = 0;
      global.fetch = vi.fn().mockImplementation(() => {
        fetchCall++;
        if (fetchCall === 1) {
          // 0.001s interval, expires_in=0.002 → maxAttempts = floor(0.002/0.001) = 2
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                device_code: 'dc',
                user_code: 'UC',
                verification_uri: 'https://github.com/login/device',
                expires_in: 0.002,
                interval: 0.001,
              }),
          });
        }
        // all polls return authorization_pending
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ error: 'authorization_pending' }),
        });
      });

      const onError = vi.fn();
      await manager.performDeviceFlowAuthentication(vi.fn(), onError, vi.fn());

      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      expect(onError).toHaveBeenCalledWith('Device code expired');
    });

    it('calls onError when poll returns access_denied', async () => {
      let call = 0;
      global.fetch = vi.fn().mockImplementation(() => {
        call++;
        if (call === 1) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                device_code: 'dc',
                user_code: 'UC',
                verification_uri: 'https://github.com/login/device',
                expires_in: 900,
                interval: 0.001,
              }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ error: 'access_denied' }),
        });
      });

      const onError = vi.fn();
      await manager.performDeviceFlowAuthentication(vi.fn(), onError, vi.fn());

      await new Promise<void>((resolve) => setTimeout(resolve, 50));

      expect(onError).toHaveBeenCalledWith('access_denied');
    });

    it('handles slow_down by increasing interval', async () => {
      let call = 0;
      global.fetch = vi.fn().mockImplementation(() => {
        call++;
        if (call === 1) {
          // startDeviceFlow
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                device_code: 'dc',
                user_code: 'UC',
                verification_uri: 'https://github.com/login/device',
                expires_in: 900,
                interval: 0.001,
              }),
          });
        }
        if (call === 2) {
          // first poll → slow_down with newInterval
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ error: 'slow_down', interval: 0.002 }),
          });
        }
        // second poll → access_denied (terminates)
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ error: 'access_denied' }),
        });
      });

      const onError = vi.fn();
      await manager.performDeviceFlowAuthentication(vi.fn(), onError, vi.fn());

      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      expect(onError).toHaveBeenCalledWith('access_denied');
    });

    it('handles slow_down fallback interval when server omits newInterval', async () => {
      // When newInterval is missing, the code does: interval += 5
      // If the initial interval is 5, it becomes 10 — too slow for a real-timer test.
      // We verify this by checking the `newInterval` on pollForAccessToken directly instead.
      global.fetch = mockFetch({ error: 'slow_down' });
      const result = await manager.pollForAccessToken('dc', 5);
      expect(result.error).toBe('slow_down');
      // fallback: interval + 5 = 5 + 5 = 10
      expect(result.newInterval).toBe(10);
    });
  });

  // ── refreshCopilotToken retry / backoff paths ─────────────────────────────

  describe('refreshCopilotToken — network retry', () => {
    it('retries on recoverable network error then succeeds', async () => {
      const expiresAt = new Date(Date.now() + 3600_000).toISOString();
      let call = 0;
      global.fetch = vi.fn().mockImplementation(() => {
        call++;
        if (call === 1) {
          return Promise.reject(
            Object.assign(new Error('ETIMEDOUT'), { code: 'ETIMEDOUT' }),
          );
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ token: 'cplt-retry', expires_at: expiresAt }),
        });
      });

      // Stub setTimeout so backoff delay is instant
      const originalSetTimeout = global.setTimeout;
      vi.spyOn(global, 'setTimeout').mockImplementation((fn: any) => {
        fn();
        return 0 as any;
      });

      try {
        const result = await manager.refreshCopilotToken('gh-token', 0);
        expect(result.token).toBe('cplt-retry');
      } finally {
        vi.spyOn(global, 'setTimeout').mockRestore();
      }
    });
  });
});
