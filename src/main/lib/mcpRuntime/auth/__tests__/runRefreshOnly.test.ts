/**
 * Tests for `runRefreshOnly` — the proactive-refresh helper that drives
 * the SDK's `auth()` while ensuring it can NEVER open the user's browser.
 *
 * Regression coverage for the issue where the proactive refresh path
 * called `performOAuthFlow` directly. The MCP SDK's `auth()` silently
 * falls through to `redirectToAuthorization` whenever the refresh-token
 * grant throws anything that isn't an `OAuthError` (transient 5xx, DNS
 * hiccup, captive portal, AbortSignal, malformed token-endpoint body).
 * That meant a network blip mid-conversation could pop a sign-in tab on
 * the user with no warning.
 *
 * Strategy:
 *   - Mock the SDK's `auth()` so we observe what kind of provider is
 *     handed in and whether `redirectToAuthorization` actually runs when
 *     the SDK invokes it.
 *   - The proxy in `runRefreshOnly` must intercept that call and throw,
 *     so any test that simulates a refresh failure must result in a
 *     thrown error (not a successful "REDIRECT" return).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { McpServerConfig } from '../../../userDataADO/types/profile';

// ─── Mocks ───────────────────────────────────────────────────────────────────

let lastProvider: any = null;
const sdkAuthMock = vi.fn();

vi.mock('@modelcontextprotocol/sdk/client/auth.js', () => ({
  auth: (...args: any[]) => {
    lastProvider = args[0];
    return sdkAuthMock(...args);
  },
}));

vi.mock('electron', () => ({
  shell: { openExternal: vi.fn(async () => true) },
}));

const callbackServer = {
  ensureRunning: vi.fn(async () => undefined),
  getRedirectUri: vi.fn(() => 'http://127.0.0.1:33420/callback'),
  waitForCode: vi.fn(),
};
vi.mock('../CallbackServer', () => ({
  getCallbackServer: () => callbackServer,
  OPENKOSMOS_DEFAULT_OAUTH_CALLBACK_PORT: 33420,
}));

let storeImpl: Record<string, any> = {};
vi.mock('../OpenKosmosTokenCache', () => ({
  OpenKosmosTokenCache: {
    getInstance: () => ({
      getMcpOAuth: vi.fn(async (key: string) => storeImpl[key] ?? null),
      setMcpOAuth: vi.fn(async (key: string, entry: any) => {
        storeImpl[key] = entry;
      }),
      deleteMcpOAuth: vi.fn(async (key: string) => {
        delete storeImpl[key];
      }),
    }),
  },
}));

vi.mock('../../unifiedLogger', () => ({
  getUnifiedLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

function makeCfg(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    name: 'test',
    transport: 'StreamableHttp',
    command: '',
    args: [],
    env: {},
    url: 'https://api.example.com/mcp',
    in_use: true,
    ...overrides,
  };
}

beforeEach(() => {
  storeImpl = {};
  sdkAuthMock.mockReset();
  callbackServer.ensureRunning.mockClear();
  callbackServer.getRedirectUri.mockClear();
  lastProvider = null;
});

describe('runRefreshOnly', () => {
  it('resolves cleanly when the SDK reports AUTHORIZED', async () => {
    sdkAuthMock.mockResolvedValueOnce('AUTHORIZED');
    const { runRefreshOnly } = await import('../performOAuthFlow');
    const { OpenKosmosOAuthProvider } = await import('../OpenKosmosOAuthProvider');
    const provider = new OpenKosmosOAuthProvider('s', makeCfg());

    await expect(runRefreshOnly(provider, 's', 'https://api.example.com/mcp'))
      .resolves.toBeUndefined();

    expect(sdkAuthMock).toHaveBeenCalledTimes(1);
  });

  it('throws (does not open browser) when the SDK reports REDIRECT', async () => {
    // The SDK can return REDIRECT only after invoking
    // provider.redirectToAuthorization. The proxy in runRefreshOnly
    // intercepts that call and throws, so the SDK never actually returns
    // REDIRECT to us — we get the proxy's throw bubbled up. Simulate the
    // SDK invoking redirectToAuthorization on whatever provider we hand
    // it to verify the proxy intercepts it.
    sdkAuthMock.mockImplementationOnce(async (provider: any) => {
      // The SDK would normally call this when it decides to redirect.
      // The proxy must throw before shell.openExternal can fire.
      await provider.redirectToAuthorization(new URL('https://example.com/oauth/authorize'));
      // Unreachable in practice — included only to detect a bypassed proxy.
      return 'REDIRECT';
    });
    const { runRefreshOnly } = await import('../performOAuthFlow');
    const { OpenKosmosOAuthProvider } = await import('../OpenKosmosOAuthProvider');
    const provider = new OpenKosmosOAuthProvider('s', makeCfg());

    await expect(runRefreshOnly(provider, 's', 'https://api.example.com/mcp'))
      .rejects.toThrow(/REFRESH_ONLY: SDK attempted to open browser/);

    // Critical: shell.openExternal MUST NOT have been called.
    const electron = await import('electron');
    expect((electron as any).shell.openExternal).not.toHaveBeenCalled();
  });

  it('propagates non-redirect SDK throws (e.g. transient 502 from token endpoint)', async () => {
    sdkAuthMock.mockRejectedValueOnce(new Error('HTTP 502 from token endpoint'));
    const { runRefreshOnly } = await import('../performOAuthFlow');
    const { OpenKosmosOAuthProvider } = await import('../OpenKosmosOAuthProvider');
    const provider = new OpenKosmosOAuthProvider('s', makeCfg());

    await expect(runRefreshOnly(provider, 's', 'https://api.example.com/mcp'))
      .rejects.toThrow(/HTTP 502/);

    const electron = await import('electron');
    expect((electron as any).shell.openExternal).not.toHaveBeenCalled();
  });

  it('honors a pre-aborted signal without invoking the SDK', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const { runRefreshOnly } = await import('../performOAuthFlow');
    const { OpenKosmosOAuthProvider } = await import('../OpenKosmosOAuthProvider');
    const provider = new OpenKosmosOAuthProvider('s', makeCfg());

    await expect(
      runRefreshOnly(provider, 's', 'https://api.example.com/mcp', { signal: ctrl.signal }),
    ).rejects.toThrow();

    expect(sdkAuthMock).not.toHaveBeenCalled();
  });

  it('preserves the underlying provider methods (saveTokens, tokens, …) on the proxy', async () => {
    // The proxy must transparently forward every method except
    // redirectToAuthorization. saveTokens is the most important — without
    // it the SDK's successful refresh would not persist the new token.
    sdkAuthMock.mockImplementationOnce(async (provider: any) => {
      // Simulate the SDK invoking saveTokens after a successful refresh.
      await provider.saveTokens({
        access_token: 'NEW-AT',
        refresh_token: 'NEW-RT',
        expires_in: 3600,
        scope: 'read',
        token_type: 'Bearer',
      });
      return 'AUTHORIZED';
    });

    const { runRefreshOnly } = await import('../performOAuthFlow');
    const { OpenKosmosOAuthProvider } = await import('../OpenKosmosOAuthProvider');
    const provider = new OpenKosmosOAuthProvider('s', makeCfg());

    await runRefreshOnly(provider, 's', 'https://api.example.com/mcp');

    const stored = storeImpl[provider.debugServerKey];
    expect(stored?.accessToken).toBe('NEW-AT');
    expect(stored?.refreshToken).toBe('NEW-RT');
  });
});
