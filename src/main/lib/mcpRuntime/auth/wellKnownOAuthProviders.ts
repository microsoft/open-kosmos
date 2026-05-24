/**
 * Hand-curated catalog of OAuth providers that don't publish RFC 8414 /
 * OIDC discovery metadata (GitHub, Slack, …). Provides synthetic metadata
 * so the SDK gets correct `authorization_endpoint` / `token_endpoint`,
 * and a `dcrSupported: false` flag so `McpAuthService` short-circuits to
 * the DCR-fallback dialog instead of letting the SDK 404 on `/register`.
 *
 * Adding a provider: entry here + matching entry in
 * `dcrFallbackInstructions.ts` (keep in sync).
 */

import type { McpResolvedAuthMetadata } from './types';

export interface WellKnownOAuthProvider {
  label: string;
  /** Hostname/pathname substrings matched against issuer or AS URL. */
  matchHosts: string[];
  authorizationEndpoint: string;
  tokenEndpoint: string;
  revocationEndpoint?: string;
  /**
   * `false` → `McpAuthService` skips DCR and shows the fallback dialog.
   * `undefined` → unknown; OAuth flow probes naturally.
   */
  dcrSupported?: boolean;
  defaultScope?: string;
}

const PROVIDERS: WellKnownOAuthProvider[] = [
  {
    label: 'GitHub',
    matchHosts: ['github.com/login/oauth', 'github.com'],
    authorizationEndpoint: 'https://github.com/login/oauth/authorize',
    tokenEndpoint: 'https://github.com/login/oauth/access_token',
    dcrSupported: false,
  },
  {
    label: 'GitLab',
    // GitLab DOES publish OIDC discovery, but gracefully fall back if the SDK
    // probe fails for any reason.
    matchHosts: ['gitlab.com'],
    authorizationEndpoint: 'https://gitlab.com/oauth/authorize',
    tokenEndpoint: 'https://gitlab.com/oauth/token',
    revocationEndpoint: 'https://gitlab.com/oauth/revoke',
    dcrSupported: false,
  },
  {
    label: 'Slack',
    matchHosts: ['slack.com'],
    authorizationEndpoint: 'https://slack.com/oauth/v2/authorize',
    tokenEndpoint: 'https://slack.com/api/oauth.v2.access',
    dcrSupported: false,
  },
  {
    label: 'Google',
    matchHosts: ['accounts.google.com', 'googleapis.com'],
    authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenEndpoint: 'https://oauth2.googleapis.com/token',
    revocationEndpoint: 'https://oauth2.googleapis.com/revoke',
    dcrSupported: false,
  },
  {
    label: 'Notion',
    matchHosts: ['notion.so', 'notion.com', 'api.notion.com'],
    authorizationEndpoint: 'https://api.notion.com/v1/oauth/authorize',
    tokenEndpoint: 'https://api.notion.com/v1/oauth/token',
    dcrSupported: false,
  },
  {
    label: 'Discord',
    matchHosts: ['discord.com'],
    authorizationEndpoint: 'https://discord.com/oauth2/authorize',
    tokenEndpoint: 'https://discord.com/api/oauth2/token',
    revocationEndpoint: 'https://discord.com/api/oauth2/token/revoke',
    dcrSupported: false,
  },
];

/** Find the catalog entry whose `matchHosts` substring is in the issuer/AS URL. */
export function findWellKnownProvider(metadata: McpResolvedAuthMetadata): WellKnownOAuthProvider | undefined {
  const haystack = `${metadata.authorizationServerUrl} ${metadata.authorizationServerMetadata.issuer ?? ''}`.toLowerCase();
  for (const provider of PROVIDERS) {
    if (provider.matchHosts.some((host) => haystack.includes(host))) {
      return provider;
    }
  }
  return undefined;
}

export function isKnownToNotSupportDcr(metadata: McpResolvedAuthMetadata): boolean {
  return findWellKnownProvider(metadata)?.dcrSupported === false;
}

/**
 * Wrap `innerFetch` to intercept the SDK's well-known metadata probes
 * and return synthesized metadata for catalog providers. All other
 * requests pass through unchanged.
 */
export function createSyntheticMetadataFetch(
  innerFetch: typeof fetch,
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const urlString = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;

    if (!isWellKnownMetadataPath(urlString)) {
      return innerFetch(input, init);
    }

    const provider = findProviderByMetadataUrl(urlString);
    if (!provider) {
      return innerFetch(input, init);
    }

    const synthetic = {
      issuer: deriveIssuer(provider, urlString),
      authorization_endpoint: provider.authorizationEndpoint,
      token_endpoint: provider.tokenEndpoint,
      response_types_supported: ['code'],
      code_challenge_methods_supported: ['S256'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
      ...(provider.revocationEndpoint ? { revocation_endpoint: provider.revocationEndpoint } : {}),
    };

    return new Response(JSON.stringify(synthetic), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
}

function isWellKnownMetadataPath(url: string): boolean {
  return (
    url.includes('/.well-known/oauth-authorization-server') ||
    url.includes('/.well-known/openid-configuration')
  );
}

function findProviderByMetadataUrl(url: string): WellKnownOAuthProvider | undefined {
  const lower = url.toLowerCase();
  for (const provider of PROVIDERS) {
    if (provider.matchHosts.some((host) => lower.includes(host))) {
      return provider;
    }
  }
  return undefined;
}

/** Strip the well-known suffix to get a usable `issuer` value. */
function deriveIssuer(provider: WellKnownOAuthProvider, urlString: string): string {
  try {
    const u = new URL(urlString);
    return `${u.origin}${u.pathname.replace(/\/?\.well-known\/(oauth-authorization-server|openid-configuration).*$/i, '')}`;
  } catch {
    return `https://${provider.matchHosts[0].split('/')[0]}`;
  }
}

/** Test seam. */
export function __getProvidersForTests(): readonly WellKnownOAuthProvider[] {
  return PROVIDERS;
}
