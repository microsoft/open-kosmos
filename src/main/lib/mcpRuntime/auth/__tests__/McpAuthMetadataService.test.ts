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
        authorization_servers: ['https://auth.example.com/tenant'],
        scopes_supported: ['api://resource/user_impersonation'],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        issuer: 'https://auth.example.com/tenant',
        authorization_endpoint: 'https://auth.example.com/tenant/authorize',
        token_endpoint: 'https://auth.example.com/tenant/token',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));

    const headers = new Headers({
      'WWW-Authenticate': 'Bearer authorization_uri="https://auth.example.com/tenant/authorize", resource_metadata="https://example.com/.well-known/oauth-protected-resource/mcp", scope="api://resource/user_impersonation"',
    });

    const resolved = await McpAuthMetadataService.resolve('https://example.com/mcp', headers);

    expect(resolved?.authorizationServerUrl).toBe('https://auth.example.com/tenant');
    expect(resolved?.providerLabel).toBe('Identity Provider');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
