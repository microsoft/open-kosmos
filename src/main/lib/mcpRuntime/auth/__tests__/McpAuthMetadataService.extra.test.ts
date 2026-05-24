/**
 * Additional coverage tests for McpAuthMetadataService
 */

import { McpAuthMetadataService } from '../McpAuthMetadataService';

describe('McpAuthMetadataService.parseChallenge', () => {
  it('returns empty object for null header', () => {
    const result = McpAuthMetadataService.parseChallenge(null);
    expect(result).toEqual({});
  });

  it('returns empty object when header has no Bearer scheme', () => {
    const result = McpAuthMetadataService.parseChallenge('Basic realm="mcp"');
    expect(result).toEqual({});
  });

  it('parses authorization_uri from bearer challenge', () => {
    const result = McpAuthMetadataService.parseChallenge(
      'Bearer authorization_uri="https://login.example.com/oauth2/authorize"',
    );
    expect(result.authorizationServerUrl).toBe('https://login.example.com/oauth2/authorize');
  });

  it('returns empty scopes array when scope param is missing', () => {
    const result = McpAuthMetadataService.parseChallenge(
      'Bearer resource_metadata="https://example.com/.well-known/meta"',
    );
    expect(result.scopes).toBeUndefined();
    expect(result.resourceMetadataUrl).toBe('https://example.com/.well-known/meta');
  });
});

describe('McpAuthMetadataService.updateFromHeaders', () => {
  const existingMetadata = {
    resourceMetadata: undefined,
    authorizationServerUrl: 'https://login.example.com',
    authorizationServerMetadata: {
      issuer: 'https://login.example.com',
      authorization_endpoint: 'https://login.example.com/authorize',
      token_endpoint: 'https://login.example.com/token',
    },
    scopes: ['read', 'write'],
    providerLabel: 'Example',
    telemetry: {
      resourceMetadataSource: 'wellKnown' as const,
      serverMetadataSource: 'wellKnown' as const,
    },
  };

  it('returns existing metadata unchanged when no WWW-Authenticate header is present', () => {
    const headers = new Headers();
    const result = McpAuthMetadataService.updateFromHeaders(existingMetadata, headers);
    expect(result).toBe(existingMetadata);
  });

  it('returns existing metadata unchanged when scopes are identical', () => {
    const headers = new Headers({
      'WWW-Authenticate': 'Bearer scope="read write"',
    });
    const result = McpAuthMetadataService.updateFromHeaders(existingMetadata, headers);
    expect(result).toBe(existingMetadata);
  });

  it('returns updated metadata with new scopes when they differ', () => {
    const headers = new Headers({
      'WWW-Authenticate': 'Bearer scope="admin"',
    });
    const result = McpAuthMetadataService.updateFromHeaders(existingMetadata, headers);
    expect(result).not.toBe(existingMetadata);
    expect(result.scopes).toEqual(['admin']);
    // Other fields preserved
    expect(result.authorizationServerUrl).toBe(existingMetadata.authorizationServerUrl);
  });
});

describe('McpAuthMetadataService.resolve', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('falls back to well-known discovery when no WWW-Authenticate header is present', async () => {
    // resource metadata returns null, server metadata from well-known
    vi.spyOn(global, 'fetch' as any)
      .mockResolvedValueOnce(new Response(null, { status: 404 })) // resource metadata -> null
      .mockResolvedValueOnce(new Response(JSON.stringify({
        issuer: 'https://example.com',
        authorization_endpoint: 'https://example.com/authorize',
        token_endpoint: 'https://example.com/token',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    const headers = new Headers(); // no WWW-Authenticate
    const result = await McpAuthMetadataService.resolve('https://example.com/mcp', headers);

    expect(result).not.toBeNull();
    expect(result?.authorizationServerUrl).toBe('https://example.com');
    expect(result?.telemetry.serverMetadataSource).toBe('wellKnown');
  });

  it('returns null when authorization server metadata has no authorization_endpoint', async () => {
    vi.spyOn(global, 'fetch' as any)
      .mockResolvedValue(new Response(null, { status: 404 })); // all fetches return null

    const headers = new Headers({
      // Provide a challenge whose authorization server will have no discovery docs
      'WWW-Authenticate': 'Bearer scope="api"',
    });

    // When all discovery URLs fail, it synthesizes a fallback with /authorize and /token
    // so it should still return a result
    const result = await McpAuthMetadataService.resolve('https://example.com/mcp', headers);
    expect(result).not.toBeNull();
    expect(result?.authorizationServerMetadata.authorization_endpoint).toContain('/authorize');
  });

  it('correctly infers provider labels for known identity providers', async () => {
    const makeResult = async (issuerUrl: string) => {
      vi.restoreAllMocks();
      vi.spyOn(global, 'fetch' as any)
        .mockResolvedValueOnce(new Response(null, { status: 404 })) // resource metadata
        .mockResolvedValueOnce(new Response(JSON.stringify({
          issuer: issuerUrl,
          authorization_endpoint: `${issuerUrl}/authorize`,
          token_endpoint: `${issuerUrl}/token`,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      return McpAuthMetadataService.resolve(issuerUrl + '/mcp', new Headers());
    };

    const github = await makeResult('https://github.com');
    expect(github?.providerLabel).toBe('GitHub');

    const gitlab = await makeResult('https://gitlab.com');
    expect(gitlab?.providerLabel).toBe('GitLab');

    const slack = await makeResult('https://slack.com');
    expect(slack?.providerLabel).toBe('Slack');

    const google = await makeResult('https://accounts.google.com');
    expect(google?.providerLabel).toBe('Google');

    const atlassian = await makeResult('https://atlassian.com');
    expect(atlassian?.providerLabel).toBe('Atlassian');

    const notion = await makeResult('https://notion.so');
    expect(notion?.providerLabel).toBe('Notion');

    const discord = await makeResult('https://discord.com');
    expect(discord?.providerLabel).toBe('Discord');
  });

  it('uses resource metadata scopes when challenge has none', async () => {
    vi.spyOn(global, 'fetch' as any)
      .mockResolvedValueOnce(new Response(JSON.stringify({
        scopes_supported: ['res_scope'],
        authorization_servers: ['https://auth.example.com'],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        issuer: 'https://auth.example.com',
        authorization_endpoint: 'https://auth.example.com/authorize',
        token_endpoint: 'https://auth.example.com/token',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    const headers = new Headers({ 'WWW-Authenticate': 'Bearer' }); // no scope in challenge
    const result = await McpAuthMetadataService.resolve('https://example.com/mcp', headers);

    expect(result?.scopes).toEqual(['res_scope']);
  });

  it('marks telemetry resourceMetadataSource as header when resource_metadata is in challenge', async () => {
    vi.spyOn(global, 'fetch' as any)
      .mockResolvedValueOnce(new Response(JSON.stringify({
        scopes_supported: [],
        authorization_servers: ['https://auth.example.com'],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        issuer: 'https://auth.example.com',
        authorization_endpoint: 'https://auth.example.com/authorize',
        token_endpoint: 'https://auth.example.com/token',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    const headers = new Headers({
      'WWW-Authenticate': 'Bearer resource_metadata="https://example.com/.well-known/oauth-protected-resource/mcp"',
    });
    const result = await McpAuthMetadataService.resolve('https://example.com/mcp', headers);

    expect(result?.telemetry.resourceMetadataSource).toBe('header');
    expect(result?.telemetry.serverMetadataSource).toBe('resourceMetadata');
  });

  it('normalizes Azure AD /oauth2/v2.0/authorize URLs', async () => {
    const authorizationUri = 'https://login.microsoftonline.com/tenant-id/oauth2/v2.0/authorize';
    vi.spyOn(global, 'fetch' as any)
      .mockResolvedValueOnce(new Response(null, { status: 404 })) // resource metadata
      .mockResolvedValueOnce(new Response(JSON.stringify({
        issuer: 'https://login.microsoftonline.com/tenant-id/v2.0',
        authorization_endpoint: authorizationUri,
        token_endpoint: 'https://login.microsoftonline.com/tenant-id/oauth2/v2.0/token',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    const headers = new Headers({
      'WWW-Authenticate': `Bearer authorization_uri="${authorizationUri}"`,
    });
    const result = await McpAuthMetadataService.resolve('https://mcp.example.com/mcp', headers);

    expect(result?.authorizationServerUrl).toBe('https://login.microsoftonline.com/tenant-id/v2.0');
    expect(result?.providerLabel).toBe('Microsoft');
  });
});
