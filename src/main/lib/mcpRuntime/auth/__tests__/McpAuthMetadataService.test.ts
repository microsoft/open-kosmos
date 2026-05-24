import { McpAuthMetadataService } from '../McpAuthMetadataService';

describe('McpAuthMetadataService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parses bearer challenge scope and resource metadata', () => {
    const parsed = McpAuthMetadataService.parseChallenge(
      'Bearer resource_metadata="https://example.com/.well-known/oauth-protected-resource/mcp", scope="api://app/.default offline_access"'
    );

    expect(parsed.resourceMetadataUrl).toBe('https://example.com/.well-known/oauth-protected-resource/mcp');
    expect(parsed.scopes).toEqual(['api://app/.default', 'offline_access']);
  });

  it('prefers protected resource authorization_servers over authorization_uri challenge endpoints', async () => {
    const fetchMock = vi.spyOn(global, 'fetch' as any)
      .mockResolvedValueOnce(new Response(JSON.stringify({
        authorization_servers: ['https://login.microsoftonline.com/tenant-id/v2.0'],
        scopes_supported: ['api://resource/user_impersonation'],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        issuer: 'https://login.microsoftonline.com/tenant-id/v2.0',
        authorization_endpoint: 'https://login.windows.net/tenant-id/oauth2/v2.0/authorize',
        token_endpoint: 'https://login.windows.net/tenant-id/oauth2/v2.0/token',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));

    const headers = new Headers({
      'WWW-Authenticate': 'Bearer authorization_uri="https://login.windows.net/tenant-id/oauth2/v2.0/authorize", resource_metadata="https://example.com/.well-known/oauth-protected-resource/mcp", scope="api://resource/user_impersonation"',
    });

    const resolved = await McpAuthMetadataService.resolve('https://example.com/mcp', headers);

    expect(resolved?.authorizationServerUrl).toBe('https://login.microsoftonline.com/tenant-id/v2.0');
    expect(resolved?.providerLabel).toBe('Microsoft');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
