import { getUnifiedLogger } from '../../unifiedLogger';
import {
  McpAuthChallengeInfo,
  McpResolvedAuthMetadata,
  OAuthAuthorizationServerMetadata,
  OAuthProtectedResourceMetadata,
} from './types';

const logger = getUnifiedLogger();

function parseChallengeParams(value: string): Record<string, string> {
  const result: Record<string, string> = {};
  const regex = /(\w+)=(?:"([^"]*)"|([^,\s]+))/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(value)) !== null) {
    result[match[1].toLowerCase()] = match[2] ?? match[3] ?? '';
  }
  return result;
}

function parseBearerChallenge(headerValue: string | null): McpAuthChallengeInfo {
  if (!headerValue) {
    return {};
  }

  const bearerMatch = headerValue.match(/Bearer\s+(.+)/i);
  if (!bearerMatch) {
    return {};
  }

  const params = parseChallengeParams(bearerMatch[1]);
  return {
    scopes: params.scope ? params.scope.split(/\s+/).map(s => s.trim()).filter(Boolean) : undefined,
    resourceMetadataUrl: params.resource_metadata,
    authorizationServerUrl: params.authorization_uri,
  };
}

function getProtectedResourceMetadataUrl(serverUrl: URL): string {
  const pathName = serverUrl.pathname && serverUrl.pathname !== '/' ? serverUrl.pathname : '';
  return new URL(`/.well-known/oauth-protected-resource${pathName}`, serverUrl).toString();
}

function normalizeAuthorizationServerUrl(serverUrl: string | undefined): string | undefined {
  if (!serverUrl) {
    return undefined;
  }

  try {
    const url = new URL(serverUrl);
    const normalizedPath = url.pathname
      .replace(/\/oauth2\/v2\.0\/authorize\/?$/i, '/v2.0')
      .replace(/\/oauth2\/authorize\/?$/i, '')
      .replace(/\/authorize\/?$/i, '');

    url.pathname = normalizedPath || '/';
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return serverUrl;
  }
}

function buildAuthorizationServerDiscoveryUrls(serverUrl: string): string[] {
  const url = new URL(serverUrl);
  const pathName = url.pathname.replace(/\/$/, '');
  const candidates = [
    new URL(`/.well-known/oauth-authorization-server${pathName}`, url.origin).toString(),
    new URL(`${pathName || ''}/.well-known/oauth-authorization-server`, url.origin).toString(),
    new URL(`/.well-known/openid-configuration${pathName}`, url.origin).toString(),
    new URL(`${pathName || ''}/.well-known/openid-configuration`, url.origin).toString(),
  ];

  return Array.from(new Set(candidates));
}

async function fetchJson<T>(url: string, headers?: Record<string, string>): Promise<T | null> {
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...headers,
      },
    });

    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }

    return await response.json() as T;
  } catch {
    return null;
  }
}

function inferProviderLabel(metadataUrl: string, metadata?: OAuthAuthorizationServerMetadata): string {
  const url = `${metadata?.issuer || ''} ${metadataUrl}`.toLowerCase();
  if (url.includes('login.microsoftonline.com') || url.includes('microsoftonline.com') || url.includes('login.windows.net') || url.includes('microsoft.com')) {
    return 'Microsoft';
  }
  if (url.includes('github.com')) {
    return 'GitHub';
  }
  if (url.includes('gitlab.com')) {
    return 'GitLab';
  }
  if (url.includes('slack.com')) {
    return 'Slack';
  }
  if (url.includes('accounts.google.com') || url.includes('googleapis.com')) {
    return 'Google';
  }
  if (url.includes('atlassian.com')) {
    return 'Atlassian';
  }
  if (url.includes('notion.so') || url.includes('notion.com')) {
    return 'Notion';
  }
  if (url.includes('discord.com')) {
    return 'Discord';
  }
  return 'Identity Provider';
}

export class McpAuthMetadataService {
  static async resolve(serverUrl: string, responseHeaders: Headers): Promise<McpResolvedAuthMetadata | null> {
    const challenge = parseBearerChallenge(responseHeaders.get('WWW-Authenticate'));
    let resourceMetadataSource: McpResolvedAuthMetadata['telemetry']['resourceMetadataSource'] = 'none';
    let serverMetadataSource: McpResolvedAuthMetadata['telemetry']['serverMetadataSource'] = 'default';

    const sameOriginHeaders = { 'MCP-Protocol-Version': '2024-11-05' };
    const resourceMetadataUrl = challenge.resourceMetadataUrl || getProtectedResourceMetadataUrl(new URL(serverUrl));
    const resourceMetadata = await fetchJson<OAuthProtectedResourceMetadata>(resourceMetadataUrl, sameOriginHeaders);

    if (resourceMetadata) {
      resourceMetadataSource = challenge.resourceMetadataUrl ? 'header' : 'wellKnown';
    }

    const scopes = challenge.scopes
      ?? resourceMetadata?.scopes_supported
      ?? [];

    const authorizationServerUrl = resourceMetadata?.authorization_servers?.[0]
      || normalizeAuthorizationServerUrl(challenge.authorizationServerUrl)
      || new URL(serverUrl).origin;

    let authorizationServerMetadata: OAuthAuthorizationServerMetadata | null = null;
    for (const discoveryUrl of buildAuthorizationServerDiscoveryUrls(authorizationServerUrl)) {
      authorizationServerMetadata = await fetchJson<OAuthAuthorizationServerMetadata>(discoveryUrl, sameOriginHeaders);
      if (authorizationServerMetadata) {
        serverMetadataSource = challenge.authorizationServerUrl || resourceMetadata?.authorization_servers?.[0]
          ? 'resourceMetadata'
          : 'wellKnown';
        break;
      }
    }

    if (!authorizationServerMetadata) {
      authorizationServerMetadata = {
        issuer: authorizationServerUrl,
        authorization_endpoint: `${authorizationServerUrl.replace(/\/$/, '')}/authorize`,
        token_endpoint: `${authorizationServerUrl.replace(/\/$/, '')}/token`,
      };
      serverMetadataSource = 'default';
    }

    if (!authorizationServerMetadata.authorization_endpoint || !authorizationServerMetadata.token_endpoint) {
      logger.warn(`[McpAuthMetadataService] Incomplete authorization server metadata for ${authorizationServerUrl}`);
      return null;
    }

    return {
      resourceMetadata: resourceMetadata || undefined,
      authorizationServerUrl,
      authorizationServerMetadata,
      scopes,
      providerLabel: inferProviderLabel(authorizationServerUrl, authorizationServerMetadata),
      telemetry: {
        resourceMetadataSource,
        serverMetadataSource,
      },
    };
  }

  static parseChallenge(headerValue: string | null): McpAuthChallengeInfo {
    return parseBearerChallenge(headerValue);
  }

  static updateFromHeaders(existing: McpResolvedAuthMetadata, responseHeaders: Headers): McpResolvedAuthMetadata {
    const challenge = parseBearerChallenge(responseHeaders.get('WWW-Authenticate'));
    const scopes = challenge.scopes;

    if (!scopes || JSON.stringify(scopes) === JSON.stringify(existing.scopes)) {
      return existing;
    }

    logger.info(`[McpAuthMetadataService] Scopes changed from ${JSON.stringify(existing.scopes)} to ${JSON.stringify(scopes)}`);
    return {
      ...existing,
      scopes,
    };
  }
}
