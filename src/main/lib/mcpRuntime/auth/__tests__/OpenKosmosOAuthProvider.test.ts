/**
 * Tests for OpenKosmosOAuthProvider — the SDK OAuthClientProvider implementation
 * for non-Microsoft MCP servers.
 *
 * Focus areas:
 *   - clientInformation lookup priority (cache > cfg.oauth > undefined)
 *   - tokens() proactive 5-minute refresh window
 *   - tokens() step-up scope omission of refresh_token
 *   - invalidateCredentials per scope
 *   - saveTokens / saveClientInformation persistence
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { McpServerConfig } from '../../../userDataADO/types/profile';
import type { PersistedMcpOAuthEntry } from '../OpenKosmosTokenCache';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('electron', () => ({
  shell: { openExternal: vi.fn(async () => true) },
}));

const callbackServer = {
  ensureRunning: vi.fn(async () => undefined),
  getRedirectUri: vi.fn(() => 'http://127.0.0.1:33420/callback'),
};
vi.mock('../CallbackServer', () => ({
  getCallbackServer: () => callbackServer,
  OPENKOSMOS_DEFAULT_OAUTH_CALLBACK_PORT: 33420,
}));

// In-memory backing for OpenKosmosTokenCache.mcpOAuth
let storeImpl: Record<string, PersistedMcpOAuthEntry> = {};
const cacheMock = {
  getMcpOAuth: vi.fn(async (key: string) => storeImpl[key] ?? null),
  setMcpOAuth: vi.fn(async (key: string, entry: PersistedMcpOAuthEntry) => {
    storeImpl[key] = entry;
  }),
  deleteMcpOAuth: vi.fn(async (key: string) => {
    delete storeImpl[key];
  }),
};
vi.mock('../OpenKosmosTokenCache', () => ({
  OpenKosmosTokenCache: { getInstance: () => cacheMock },
}));

vi.mock('../../unifiedLogger', () => ({
  getUnifiedLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeCfg(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    name: 'github',
    transport: 'StreamableHttp',
    command: '',
    args: [],
    env: {},
    url: 'https://api.example.com/mcp/',
    in_use: true,
    ...overrides,
  };
}

beforeEach(() => {
  storeImpl = {};
  cacheMock.getMcpOAuth.mockClear();
  cacheMock.setMcpOAuth.mockClear();
  cacheMock.deleteMcpOAuth.mockClear();
  callbackServer.ensureRunning.mockClear();
  callbackServer.getRedirectUri.mockClear();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('OpenKosmosOAuthProvider', () => {
  describe('redirectUrl + clientMetadata', () => {
    it('exposes the CallbackServer redirect URI', async () => {
      const { OpenKosmosOAuthProvider } = await import('../OpenKosmosOAuthProvider');
      const p = new OpenKosmosOAuthProvider('s', makeCfg());
      expect(p.redirectUrl).toBe('http://127.0.0.1:33420/callback');
    });

    it('clientMetadata declares public PKCE client', async () => {
      const { OpenKosmosOAuthProvider } = await import('../OpenKosmosOAuthProvider');
      const p = new OpenKosmosOAuthProvider('s', makeCfg());
      const m = p.clientMetadata;
      expect(m.token_endpoint_auth_method).toBe('none');
      expect(m.grant_types).toEqual(['authorization_code', 'refresh_token']);
      expect(m.response_types).toEqual(['code']);
      expect(m.redirect_uris).toEqual(['http://127.0.0.1:33420/callback']);
    });
  });

  describe('state', () => {
    it('returns a stable random base64url string within an instance', async () => {
      const { OpenKosmosOAuthProvider } = await import('../OpenKosmosOAuthProvider');
      const p = new OpenKosmosOAuthProvider('s', makeCfg());
      const a = p.state();
      const b = p.state();
      expect(a).toBe(b);
      expect(a.length).toBeGreaterThan(20);
      expect(/^[A-Za-z0-9_-]+$/.test(a)).toBe(true);
    });

    it('generates different state values across instances', async () => {
      const { OpenKosmosOAuthProvider } = await import('../OpenKosmosOAuthProvider');
      const a = new OpenKosmosOAuthProvider('s', makeCfg()).state();
      const b = new OpenKosmosOAuthProvider('s', makeCfg()).state();
      expect(a).not.toBe(b);
    });
  });

  describe('clientInformation lookup priority', () => {
    it('1. cache wins when populated', async () => {
      const { OpenKosmosOAuthProvider } = await import('../OpenKosmosOAuthProvider');
      const p = new OpenKosmosOAuthProvider('s', makeCfg({ oauth: { clientId: 'from-cfg' } }));
      storeImpl[p.debugServerKey] = {
        serverName: 's',
        serverUrl: 'https://x',
        accessToken: '',
        expiresAt: 0,
        clientId: 'from-cache',
      };
      const info = await p.clientInformation();
      expect(info?.client_id).toBe('from-cache');
    });

    it('2. cfg.oauth.clientId is used when cache is empty', async () => {
      const { OpenKosmosOAuthProvider } = await import('../OpenKosmosOAuthProvider');
      const p = new OpenKosmosOAuthProvider('s', makeCfg({
        oauth: { clientId: 'from-cfg', clientSecret: 'sec' },
      }));
      const info = await p.clientInformation();
      expect(info?.client_id).toBe('from-cfg');
      expect(info?.client_secret).toBe('sec');
    });

    it('3. returns undefined when neither cache nor cfg has clientId', async () => {
      const { OpenKosmosOAuthProvider } = await import('../OpenKosmosOAuthProvider');
      const p = new OpenKosmosOAuthProvider('s', makeCfg());
      expect(await p.clientInformation()).toBeUndefined();
    });
  });

  describe('saveClientInformation', () => {
    it('persists the DCR client info into the cache slot', async () => {
      const { OpenKosmosOAuthProvider } = await import('../OpenKosmosOAuthProvider');
      const p = new OpenKosmosOAuthProvider('s', makeCfg());
      await p.saveClientInformation({ client_id: 'abc', client_secret: 'xyz' } as any);
      const stored = storeImpl[p.debugServerKey];
      expect(stored?.clientId).toBe('abc');
      expect(stored?.clientSecret).toBe('xyz');
      expect(stored?.serverName).toBe('s');
    });
  });

  describe('tokens', () => {
    it('returns undefined when cache is empty', async () => {
      const { OpenKosmosOAuthProvider } = await import('../OpenKosmosOAuthProvider');
      const p = new OpenKosmosOAuthProvider('s', makeCfg());
      expect(await p.tokens()).toBeUndefined();
    });

    it('returns undefined when accessToken is empty marker (DCR-only state)', async () => {
      const { OpenKosmosOAuthProvider } = await import('../OpenKosmosOAuthProvider');
      const p = new OpenKosmosOAuthProvider('s', makeCfg());
      storeImpl[p.debugServerKey] = {
        serverName: 's',
        serverUrl: 'x',
        accessToken: '',
        expiresAt: 0,
        clientId: 'dcr-issued',
      };
      expect(await p.tokens()).toBeUndefined();
    });

    it('returns the token when valid and far from expiry', async () => {
      const { OpenKosmosOAuthProvider } = await import('../OpenKosmosOAuthProvider');
      const p = new OpenKosmosOAuthProvider('s', makeCfg());
      storeImpl[p.debugServerKey] = {
        serverName: 's',
        serverUrl: 'x',
        accessToken: 'AT',
        refreshToken: 'RT',
        expiresAt: Date.now() + 60 * 60_000, // 1 hour
        scope: 'read write',
      };
      const t = await p.tokens();
      expect(t?.access_token).toBe('AT');
      expect(t?.refresh_token).toBe('RT');
      expect(t?.scope).toBe('read write');
      expect(t?.token_type).toBe('Bearer');
      expect(t?.expires_in).toBeGreaterThan(3000);
    });

    it('reports expiring token to trigger SDK refresh (within 5min window)', async () => {
      const { OpenKosmosOAuthProvider } = await import('../OpenKosmosOAuthProvider');
      const p = new OpenKosmosOAuthProvider('s', makeCfg());
      storeImpl[p.debugServerKey] = {
        serverName: 's',
        serverUrl: 'x',
        accessToken: 'AT',
        refreshToken: 'RT',
        expiresAt: Date.now() + 60_000, // 1 min, inside 5-min window
      };
      const t = await p.tokens();
      // Even within the proactive window we still surface the refresh_token
      // so the SDK can switch to refresh-token grant.
      expect(t?.access_token).toBe('AT');
      expect(t?.refresh_token).toBe('RT');
      expect(t?.expires_in).toBeLessThanOrEqual(300);
    });

    it('returns undefined when expired and no refresh token', async () => {
      const { OpenKosmosOAuthProvider } = await import('../OpenKosmosOAuthProvider');
      const p = new OpenKosmosOAuthProvider('s', makeCfg());
      storeImpl[p.debugServerKey] = {
        serverName: 's',
        serverUrl: 'x',
        accessToken: 'AT',
        expiresAt: Date.now() - 60_000,
      };
      expect(await p.tokens()).toBeUndefined();
    });
  });

  describe('saveTokens', () => {
    it('persists tokens with computed expiresAt', async () => {
      const { OpenKosmosOAuthProvider } = await import('../OpenKosmosOAuthProvider');
      const p = new OpenKosmosOAuthProvider('s', makeCfg());
      const before = Date.now();
      await p.saveTokens({
        access_token: 'NEW',
        refresh_token: 'NEW-RT',
        expires_in: 1800,
        scope: 'read write admin',
        token_type: 'Bearer',
      });
      const stored = storeImpl[p.debugServerKey];
      expect(stored?.accessToken).toBe('NEW');
      expect(stored?.refreshToken).toBe('NEW-RT');
      expect(stored?.expiresAt).toBeGreaterThanOrEqual(before + 1800 * 1000 - 50);
      expect(stored?.scope).toBe('read write admin');

      const t = await p.tokens();
      expect(t?.refresh_token).toBe('NEW-RT');
    });

    it('treats tokens with no expires_in AND no refresh_token as non-expiring (GitHub OAuth App)', async () => {
      const { OpenKosmosOAuthProvider } = await import('../OpenKosmosOAuthProvider');
      const p = new OpenKosmosOAuthProvider('s', makeCfg());
      const before = Date.now();
      await p.saveTokens({
        access_token: 'GH-AT',
        token_type: 'Bearer',
      });
      const stored = storeImpl[p.debugServerKey];
      expect(stored?.accessToken).toBe('GH-AT');
      // ~100 years in the future, well past any 1-hour fallback.
      const tenYearsMs = 10 * 365 * 24 * 60 * 60 * 1000;
      expect(stored?.expiresAt).toBeGreaterThan(before + tenYearsMs);

      // tokens() must keep returning the access token across "restarts"
      // (simulated by reading from the cache only).
      const t = await p.tokens();
      expect(t?.access_token).toBe('GH-AT');
    });

    it('falls back to 1-hour expiry when expires_in missing but refresh_token present', async () => {
      const { OpenKosmosOAuthProvider } = await import('../OpenKosmosOAuthProvider');
      const p = new OpenKosmosOAuthProvider('s', makeCfg());
      const before = Date.now();
      await p.saveTokens({
        access_token: 'AT',
        refresh_token: 'RT',
        token_type: 'Bearer',
      });
      const stored = storeImpl[p.debugServerKey];
      const expectedAt = before + 3600 * 1000;
      expect(stored?.expiresAt).toBeGreaterThanOrEqual(expectedAt - 50);
      expect(stored?.expiresAt).toBeLessThanOrEqual(expectedAt + 1000);
    });

    it('falls back to 1-hour expiry when expires_in missing but a previous refresh_token is preserved', async () => {
      const { OpenKosmosOAuthProvider } = await import('../OpenKosmosOAuthProvider');
      const p = new OpenKosmosOAuthProvider('s', makeCfg());
      // Seed a previous entry with a refresh token (e.g. earlier successful flow).
      storeImpl[p.debugServerKey] = {
        serverName: 's',
        serverUrl: 'x',
        accessToken: 'OLD',
        refreshToken: 'OLD-RT',
        expiresAt: Date.now() + 60_000,
      };
      const before = Date.now();
      await p.saveTokens({
        access_token: 'NEW',
        token_type: 'Bearer',
      });
      const stored = storeImpl[p.debugServerKey];
      // Refresh token preserved from prior entry, so the 1h fallback applies.
      expect(stored?.refreshToken).toBe('OLD-RT');
      const expectedAt = before + 3600 * 1000;
      expect(stored?.expiresAt).toBeLessThanOrEqual(expectedAt + 1000);
    });
  });

  describe('markAccessTokenExpired', () => {
    it('zeros expiresAt while preserving access + refresh tokens and clientId', async () => {
      const { OpenKosmosOAuthProvider } = await import('../OpenKosmosOAuthProvider');
      const p = new OpenKosmosOAuthProvider('s', makeCfg());
      storeImpl[p.debugServerKey] = {
        serverName: 's',
        serverUrl: 'x',
        accessToken: 'AT',
        refreshToken: 'RT',
        expiresAt: Date.now() + 60 * 60_000,
        clientId: 'CID',
        clientSecret: 'CSEC',
        scope: 'read',
      };
      await p.markAccessTokenExpired();
      const stored = storeImpl[p.debugServerKey];
      expect(stored?.accessToken).toBe('AT');
      expect(stored?.refreshToken).toBe('RT');
      expect(stored?.clientId).toBe('CID');
      expect(stored?.clientSecret).toBe('CSEC');
      expect(stored?.scope).toBe('read');
      expect(stored?.expiresAt).toBe(0);
    });

    it('after marking expired, tokens() surfaces refresh_token so the SDK can refresh', async () => {
      const { OpenKosmosOAuthProvider } = await import('../OpenKosmosOAuthProvider');
      const p = new OpenKosmosOAuthProvider('s', makeCfg());
      storeImpl[p.debugServerKey] = {
        serverName: 's',
        serverUrl: 'x',
        accessToken: 'AT',
        refreshToken: 'RT',
        expiresAt: Date.now() + 60 * 60_000,
      };
      await p.markAccessTokenExpired();
      const t = await p.tokens();
      expect(t?.access_token).toBe('AT');
      expect(t?.refresh_token).toBe('RT');
      expect(t?.expires_in).toBe(0);
    });

    it('after marking expired with no refresh_token, tokens() returns undefined so SDK starts fresh auth', async () => {
      const { OpenKosmosOAuthProvider } = await import('../OpenKosmosOAuthProvider');
      const p = new OpenKosmosOAuthProvider('s', makeCfg());
      storeImpl[p.debugServerKey] = {
        serverName: 's',
        serverUrl: 'x',
        accessToken: 'AT',
        expiresAt: Date.now() + 60 * 60_000,
      };
      await p.markAccessTokenExpired();
      expect(await p.tokens()).toBeUndefined();
    });

    it('is a no-op when the cache slot is empty', async () => {
      const { OpenKosmosOAuthProvider } = await import('../OpenKosmosOAuthProvider');
      const p = new OpenKosmosOAuthProvider('s', makeCfg());
      await p.markAccessTokenExpired();
      expect(storeImpl[p.debugServerKey]).toBeUndefined();
    });
  });

  describe('invalidateCredentials', () => {
    function seed(p: any) {
      storeImpl[p.debugServerKey] = {
        serverName: 's',
        serverUrl: 'x',
        accessToken: 'AT',
        refreshToken: 'RT',
        expiresAt: Date.now() + 60 * 60_000,
        clientId: 'CID',
        clientSecret: 'CSEC',
      };
    }

    it('all → wipes the slot', async () => {
      const { OpenKosmosOAuthProvider } = await import('../OpenKosmosOAuthProvider');
      const p = new OpenKosmosOAuthProvider('s', makeCfg());
      seed(p);
      await p.invalidateCredentials('all');
      expect(storeImpl[p.debugServerKey]).toBeUndefined();
    });

    it('client → clears clientId/clientSecret only', async () => {
      const { OpenKosmosOAuthProvider } = await import('../OpenKosmosOAuthProvider');
      const p = new OpenKosmosOAuthProvider('s', makeCfg());
      seed(p);
      await p.invalidateCredentials('client');
      const stored = storeImpl[p.debugServerKey];
      expect(stored?.clientId).toBeUndefined();
      expect(stored?.clientSecret).toBeUndefined();
      expect(stored?.accessToken).toBe('AT'); // tokens preserved
    });

    it('tokens → clears access/refresh, preserves clientId', async () => {
      const { OpenKosmosOAuthProvider } = await import('../OpenKosmosOAuthProvider');
      const p = new OpenKosmosOAuthProvider('s', makeCfg());
      seed(p);
      await p.invalidateCredentials('tokens');
      const stored = storeImpl[p.debugServerKey];
      expect(stored?.accessToken).toBe('');
      expect(stored?.refreshToken).toBeUndefined();
      expect(stored?.expiresAt).toBe(0);
      expect(stored?.clientId).toBe('CID');
    });

    it('verifier → only clears the in-memory verifier, no cache mutation', async () => {
      const { OpenKosmosOAuthProvider } = await import('../OpenKosmosOAuthProvider');
      const p = new OpenKosmosOAuthProvider('s', makeCfg());
      seed(p);
      await p.saveCodeVerifier('VERIFIER');
      await p.invalidateCredentials('verifier');
      await expect(p.codeVerifier()).rejects.toThrow();
      // Cache untouched
      expect(storeImpl[p.debugServerKey]?.accessToken).toBe('AT');
    });
  });

  describe('PKCE verifier lifecycle', () => {
    it('saveCodeVerifier + codeVerifier round-trip', async () => {
      const { OpenKosmosOAuthProvider } = await import('../OpenKosmosOAuthProvider');
      const p = new OpenKosmosOAuthProvider('s', makeCfg());
      await p.saveCodeVerifier('abcdef');
      expect(await p.codeVerifier()).toBe('abcdef');
    });

    it('codeVerifier throws if not saved', async () => {
      const { OpenKosmosOAuthProvider } = await import('../OpenKosmosOAuthProvider');
      const p = new OpenKosmosOAuthProvider('s', makeCfg());
      await expect(p.codeVerifier()).rejects.toThrow();
    });
  });
});
