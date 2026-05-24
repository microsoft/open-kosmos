/**
 * Implements the MCP SDK's `OAuthClientProvider` for MCP servers,
 * bridging the SDK's PKCE/DCR/refresh machinery to Kosmos's
 * encrypted token cache (`OpenKosmosTokenCache.mcpOAuth`) and local callback
 * server. Routing into this provider happens upstream in
 * `McpAuthService.getTokenForServer`.
 */

import type {
  OAuthClientProvider,
} from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientInformation,
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { randomBytes } from 'crypto';
import { shell } from 'electron';
import { APP_NAME } from '../../../../shared/constants/branding';
import { OpenKosmosTokenCache, type PersistedMcpOAuthEntry } from './OpenKosmosTokenCache';
import { getUnifiedLogger } from '../../unifiedLogger';
import type { McpServerConfig } from '../../userDataADO/types/profile';
import { getCallbackServer, OPENKOSMOS_DEFAULT_OAUTH_CALLBACK_PORT } from './CallbackServer';
import { getMcpOAuthServerKey } from './serverKey';

const logger = getUnifiedLogger();

/** When the cached access token has less validity than this, surface it as
 *  expiring so the SDK's `auth()` switches to refresh-token grant. */
export const PROACTIVE_REFRESH_WINDOW_SEC = 300;

/** ~100yr; used when token response omits both `expires_in` and `refresh_token`
 *  (e.g. GitHub OAuth Apps issue non-expiring tokens). Without this, a
 *  short fallback would drop a valid token on every restart. */
const NON_EXPIRING_SENTINEL_MS = 100 * 365 * 24 * 60 * 60 * 1000;

export class OpenKosmosOAuthProvider implements OAuthClientProvider {
  private readonly serverKey: string;
  private readonly callbackPort: number;
  private _state: string | undefined;
  private _codeVerifier: string | undefined;

  constructor(
    private readonly serverName: string,
    private readonly cfg: McpServerConfig,
  ) {
    this.serverKey = getMcpOAuthServerKey(serverName, cfg);
    this.callbackPort = cfg.oauth?.callbackPort ?? OPENKOSMOS_DEFAULT_OAUTH_CALLBACK_PORT;
  }

  /** The fixed local callback port this provider's flow uses. */
  get pinnedCallbackPort(): number {
    return this.callbackPort;
  }

  get redirectUrl(): string {
    return getCallbackServer(this.callbackPort).getRedirectUri();
  }

  get clientMetadata(): OAuthClientMetadata {
    const meta: OAuthClientMetadata = {
      client_name: `${APP_NAME} (${this.serverName})`,
      redirect_uris: [this.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    };
    return meta;
  }

  /** CSRF-resistant `state` per RFC 6749 §10.12, idempotent within an instance. */
  state(): string {
    if (!this._state) {
      this._state = randomBytes(32).toString('base64url');
    }
    return this._state;
  }

  async clientInformation(): Promise<OAuthClientInformation | undefined> {
    const stored = await OpenKosmosTokenCache.getInstance().getMcpOAuth(this.serverKey);
    if (stored?.clientId) {
      return {
        client_id: stored.clientId,
        client_secret: stored.clientSecret,
      };
    }
    if (this.cfg.oauth?.clientId) {
      return {
        client_id: this.cfg.oauth.clientId,
        client_secret: this.cfg.oauth.clientSecret,
      };
    }
    // undefined → SDK runs DCR, then calls saveClientInformation.
    return undefined;
  }

  async saveClientInformation(info: OAuthClientInformationMixed): Promise<void> {
    const cache = OpenKosmosTokenCache.getInstance();
    const prev = (await cache.getMcpOAuth(this.serverKey)) ?? this.makeEmptyEntry();
    await cache.setMcpOAuth(this.serverKey, {
      ...prev,
      clientId: info.client_id,
      clientSecret: info.client_secret,
    });
    logger.info(`[McpOAuth] Persisted DCR client information for ${this.serverName}`);
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    const data = await OpenKosmosTokenCache.getInstance().getMcpOAuth(this.serverKey);
    if (!data || !data.accessToken) {
      return undefined;
    }

    const expiresInSec = (data.expiresAt - Date.now()) / 1000;

    if (expiresInSec <= 0 && !data.refreshToken) {
      return undefined;
    }

    // Inside the proactive window: surface a near-zero expires_in so the
    // SDK switches to refresh-token grant pre-emptively.
    if (expiresInSec <= PROACTIVE_REFRESH_WINDOW_SEC && data.refreshToken) {
      return {
        access_token: data.accessToken,
        refresh_token: data.refreshToken,
        expires_in: Math.max(expiresInSec, 0),
        scope: data.scope,
        token_type: 'Bearer',
      };
    }

    return {
      access_token: data.accessToken,
      refresh_token: data.refreshToken,
      expires_in: expiresInSec,
      scope: data.scope,
      token_type: 'Bearer',
    };
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    const cache = OpenKosmosTokenCache.getInstance();
    const prev = (await cache.getMcpOAuth(this.serverKey)) ?? this.makeEmptyEntry();
    const expiresAt = computeExpiresAt(tokens, prev);
    await cache.setMcpOAuth(this.serverKey, {
      ...prev,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? prev.refreshToken,
      expiresAt,
      scope: tokens.scope ?? prev.scope,
    });
    const expiresInSec = Math.round((expiresAt - Date.now()) / 1000);
    const expiryNote = expiresAt - Date.now() >= NON_EXPIRING_SENTINEL_MS
      ? 'no expiry advertised; treating as non-expiring'
      : `expires in ~${expiresInSec}s`;
    logger.info(`[McpOAuth] Persisted access token for ${this.serverName} (${expiryNote})`);
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    logger.info(`[McpOAuth] Opening browser for ${this.serverName} → ${authorizationUrl.host}${authorizationUrl.pathname}`);
    try {
      await shell.openExternal(authorizationUrl.toString());
    } catch (e) {
      // OS launch failure isn't fatal — user can still complete sign-in
      // by copy-pasting the URL.
      logger.warn(`[McpOAuth] Failed to open browser for ${this.serverName}`, 'OpenKosmosOAuthProvider', {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  async saveCodeVerifier(verifier: string): Promise<void> {
    this._codeVerifier = verifier;
  }

  async codeVerifier(): Promise<string> {
    if (!this._codeVerifier) {
      throw new Error(`[OpenKosmosOAuthProvider] No PKCE code verifier saved for ${this.serverName}`);
    }
    return this._codeVerifier;
  }

  async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier'): Promise<void> {
    const cache = OpenKosmosTokenCache.getInstance();
    if (scope === 'verifier') {
      this._codeVerifier = undefined;
      return;
    }
    const data = await cache.getMcpOAuth(this.serverKey);
    if (!data) return;

    switch (scope) {
      case 'all':
        await cache.deleteMcpOAuth(this.serverKey);
        this._codeVerifier = undefined;
        this._state = undefined;
        break;
      case 'client':
        await cache.setMcpOAuth(this.serverKey, {
          ...data,
          clientId: undefined,
          clientSecret: undefined,
        });
        break;
      case 'tokens':
        await cache.setMcpOAuth(this.serverKey, {
          ...data,
          accessToken: '',
          refreshToken: undefined,
          expiresAt: 0,
        });
        break;
    }
    logger.info(`[McpOAuth] Invalidated credentials for ${this.serverName} (scope=${scope})`);
  }

  /**
   * Zero only the access-token expiry, preserving refresh + DCR client info.
   * Used by the force-refresh path so the SDK switches to refresh-token grant;
   * NOT equivalent to `invalidateCredentials('tokens')` (which wipes refresh too).
   */
  async markAccessTokenExpired(): Promise<void> {
    const cache = OpenKosmosTokenCache.getInstance();
    const data = await cache.getMcpOAuth(this.serverKey);
    if (!data) return;
    if (data.expiresAt <= 0 && !data.accessToken) {
      return;
    }
    await cache.setMcpOAuth(this.serverKey, {
      ...data,
      expiresAt: 0,
    });
    logger.info(`[McpOAuth] Marked access token as expired for ${this.serverName} (force-refresh)`);
  }

  /** Cache key, exposed for tests and diagnostics. */
  get debugServerKey(): string {
    return this.serverKey;
  }

  private makeEmptyEntry(): PersistedMcpOAuthEntry {
    return {
      serverName: this.serverName,
      serverUrl: this.cfg.url ?? '',
      accessToken: '',
      expiresAt: 0,
    };
  }
}

/**
 * Pick `expiresAt` for a freshly-saved token bundle:
 *   - `expires_in` present → honor it
 *   - missing but refresh token available → 1h conservative fallback
 *   - missing and no refresh token (e.g. GitHub OAuth App) → sentinel,
 *     so the token isn't silently dropped on the next restart
 */
function computeExpiresAt(tokens: OAuthTokens, prev: PersistedMcpOAuthEntry): number {
  if (tokens.expires_in && Number.isFinite(tokens.expires_in)) {
    return Date.now() + tokens.expires_in * 1000;
  }
  const hasRefresh = Boolean(tokens.refresh_token ?? prev.refreshToken);
  if (hasRefresh) {
    return Date.now() + 3600 * 1000;
  }
  return Date.now() + NON_EXPIRING_SENTINEL_MS;
}
