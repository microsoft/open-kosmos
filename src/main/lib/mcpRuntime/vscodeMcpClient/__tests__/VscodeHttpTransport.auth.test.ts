import { VscodeHttpTransport } from '../transport/VscodeHttpTransport';

const mockResolveMetadata = vi.fn();
const mockGetTokenForServer = vi.fn();

vi.mock('../../auth/McpAuthMetadataService', async () => ({
  McpAuthMetadataService: {
    resolve: (...args: unknown[]) => mockResolveMetadata(...args),
    updateFromHeaders: (existing: unknown, responseHeaders: Headers) => {
      const header = responseHeaders.get('WWW-Authenticate') || '';
      const scopeMatch = header.match(/scope="([^"]+)"/i);
      const scopes = scopeMatch ? scopeMatch[1].split(/\s+/).filter(Boolean) : undefined;
      if (!scopes) {
        return existing;
      }
      return {
        ...(existing as Record<string, unknown>),
        scopes,
      };
    },
  },
}));

vi.mock('../../auth/McpAuthService', async () => ({
  McpAuthService: {
    getInstance: vi.fn(() => ({
      getTokenForServer: (...args: unknown[]) => mockGetTokenForServer(...args),
    })),
  },
}));

describe('VscodeHttpTransport auth retry', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockResolveMetadata.mockReset();
    mockGetTokenForServer.mockReset();
  });

  it('retries with authorization header after resolving auth metadata', async () => {
    const fetchMock = vi.spyOn(global, 'fetch' as any)
      .mockResolvedValueOnce(new Response('Unauthorized', {
        status: 401,
        headers: {
          'WWW-Authenticate': 'Bearer resource_metadata="https://example.com/.well-known/oauth-protected-resource/mcp", scope="api://resource/.default"',
        },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));

    mockResolveMetadata.mockResolvedValue({
      authorizationServerUrl: 'https://login.microsoftonline.com/organizations/v2.0',
      authorizationServerMetadata: {
        issuer: 'https://login.microsoftonline.com/organizations/v2.0',
        authorization_endpoint: 'https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize',
        token_endpoint: 'https://login.microsoftonline.com/organizations/oauth2/v2.0/token',
      },
      scopes: ['api://resource/.default'],
      providerLabel: 'Microsoft',
      telemetry: {
        resourceMetadataSource: 'header',
        serverMetadataSource: 'resourceMetadata',
      },
    });
    mockGetTokenForServer.mockResolvedValue('test-access-token');

    const transport = new VscodeHttpTransport({
      serverName: 'edge-growth-brain',
      url: 'https://edge-growth-brain-staging.azurewebsites.net/mcp',
      headers: {},
    });

    await transport.start();
    await transport.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }));

    expect(mockResolveMetadata).toHaveBeenCalledTimes(1);
    expect(mockGetTokenForServer).toHaveBeenCalledWith(
      'edge-growth-brain',
      expect.objectContaining({ providerLabel: 'Microsoft' }),
      expect.objectContaining({ cfg: undefined }),
    );

    const secondCall = fetchMock.mock.calls[1];
    const secondCallInit = secondCall?.[1] as RequestInit | undefined;
    expect((secondCallInit?.headers as Record<string, string> | undefined)?.Authorization).toBe('Bearer test-access-token');
  });

  it('reuses auth metadata before the first fetch and force-refreshes after an authorized 401', async () => {
    const fetchMock = vi.spyOn(global, 'fetch' as any)
      .mockResolvedValueOnce(new Response('Unauthorized', {
        status: 401,
        headers: {
          'WWW-Authenticate': 'Bearer scope="api://resource/.default"',
        },
      }))
      .mockResolvedValueOnce(new Response('Unauthorized again', {
        status: 401,
        headers: {
          'WWW-Authenticate': 'Bearer scope="api://resource/.default offline_access"',
        },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));

    mockResolveMetadata.mockResolvedValue({
      authorizationServerUrl: 'https://login.microsoftonline.com/organizations/v2.0',
      authorizationServerMetadata: {
        issuer: 'https://login.microsoftonline.com/organizations/v2.0',
        authorization_endpoint: 'https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize',
        token_endpoint: 'https://login.microsoftonline.com/organizations/oauth2/v2.0/token',
      },
      scopes: ['api://resource/.default'],
      providerLabel: 'Microsoft',
      telemetry: {
        resourceMetadataSource: 'header',
        serverMetadataSource: 'resourceMetadata',
      },
    });
    mockGetTokenForServer
      .mockResolvedValueOnce('first-token')
      .mockResolvedValueOnce('second-token')
      .mockResolvedValueOnce('refreshed-token');

    const transport = new VscodeHttpTransport({
      serverName: 'edge-growth-brain',
      url: 'https://edge-growth-brain-staging.azurewebsites.net/mcp',
      headers: {},
    });

    (transport as any).authMetadata = {
      authorizationServerUrl: 'https://login.microsoftonline.com/organizations/v2.0',
      authorizationServerMetadata: {
        issuer: 'https://login.microsoftonline.com/organizations/v2.0',
        authorization_endpoint: 'https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize',
        token_endpoint: 'https://login.microsoftonline.com/organizations/oauth2/v2.0/token',
      },
      scopes: ['api://resource/.default'],
      providerLabel: 'Microsoft',
      telemetry: {
        resourceMetadataSource: 'header',
        serverMetadataSource: 'resourceMetadata',
      },
    };

    await transport.start();
    await transport.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }));

    expect(mockResolveMetadata).not.toHaveBeenCalled();
    // Note: VscodeHttpTransport now always passes a 3rd-arg options bag
    // containing the original McpServerConfig (or undefined). The test
    // doesn't supply one, so cfg is undefined; forceRefresh is set on the
    // retry call after the second 401.
    expect(mockGetTokenForServer).toHaveBeenNthCalledWith(1, 'edge-growth-brain',
      expect.objectContaining({ scopes: ['api://resource/.default'] }),
      expect.objectContaining({ cfg: undefined }));
    expect(mockGetTokenForServer).toHaveBeenNthCalledWith(2, 'edge-growth-brain',
      expect.objectContaining({ scopes: ['api://resource/.default'] }),
      expect.objectContaining({ cfg: undefined }));
    expect(mockGetTokenForServer).toHaveBeenNthCalledWith(3, 'edge-growth-brain',
      expect.objectContaining({ scopes: ['api://resource/.default'] }),
      expect.objectContaining({ forceRefresh: true, cfg: undefined }));

  });

  // ───────────────────────────────────────────────────────────────────────
  // PAT-vs-OAuth precedence tests.
  //
  // These three tests cover the end-to-end behavior the user asked about:
  // a header `Authorization: Bearer <PAT>` configured via .mcp.json (after
  // mcpBridge env-var substitution) should be sent verbatim, and the OAuth
  // path must only trigger when the server returns 401/403.
  //
  //   1. PAT valid           → header sent → 200 → OAuth path NOT invoked
  //   2. PAT invalid/expired → header sent → 401 → OAuth path takes over
  //                            and overwrites the Authorization header
  //   3. PAT missing         → mcpBridge already drops the header (covered
  //                            in mcpBridge.headers.test.ts), so this test
  //                            exercises "no Authorization preset" → 401
  //                            → OAuth path injects token from scratch
  //
  // Helper: setupPostCapture mocks fetch so every POST captures a snapshot
  // of init.headers (the production code mutates the headers object in
  // place during retry, so reading mock.calls retrospectively shows the
  // FINAL state, not the per-call state). Backchannel GETs (SSE
  // attach-after-success) get a 404 so they don't hang.
  // ───────────────────────────────────────────────────────────────────────

  function setupFetchCapture(
    postResponses: Response[],
  ): {
    fetchMock: ReturnType<typeof vi.spyOn>;
    capturedPostHeaders: Array<Record<string, string>>;
    postCallCount: () => number;
  } {
    const capturedPostHeaders: Array<Record<string, string>> = [];
    let postIdx = 0;
    const fetchMock = vi.spyOn(global, 'fetch' as any).mockImplementation(
      (async (_url: any, init?: RequestInit) => {
        const method = (init?.method ?? 'GET').toUpperCase();
        if (method === 'POST') {
          // Snapshot headers right now (cloned) so later in-place mutation
          // doesn't change what we observed at call time.
          capturedPostHeaders.push({ ...((init?.headers as Record<string, string>) ?? {}) });
          const resp = postResponses[postIdx++] ?? new Response('exhausted', { status: 500 });
          return resp;
        }
        // GET — used by the SSE backchannel attached after the first
        // successful streamable HTTP response. Return a quick 404 so the
        // backchannel loop doesn't churn.
        return new Response('', { status: 404 });
      }) as any,
    );
    return { fetchMock, capturedPostHeaders, postCallCount: () => postIdx };
  }

  it('PAT happy path: valid Authorization header → 200 → OAuth path NOT invoked', async () => {
    const { capturedPostHeaders, postCallCount } = setupFetchCapture([
      new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ]);

    const transport = new VscodeHttpTransport({
      serverName: 'github',
      url: 'https://api.githubcopilot.com/mcp/',
      headers: { Authorization: 'Bearer ghp_valid_token' },
    });

    await transport.start();
    await transport.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }));

    // Exactly one POST — no auth retry.
    expect(postCallCount()).toBe(1);
    // The Authorization header from the config was sent verbatim.
    expect(capturedPostHeaders[0]?.Authorization).toBe('Bearer ghp_valid_token');
    // Critical: OAuth machinery never touched.
    expect(mockResolveMetadata).not.toHaveBeenCalled();
    expect(mockGetTokenForServer).not.toHaveBeenCalled();
  });

  it('PAT invalid: 401 from server with preset Authorization → OAuth path overrides header', async () => {
    const { capturedPostHeaders } = setupFetchCapture([
      new Response('Unauthorized', {
        status: 401,
        headers: {
          'WWW-Authenticate': 'Bearer resource_metadata="https://api.githubcopilot.com/.well-known/oauth-protected-resource/mcp/", scope="repo"',
        },
      }),
      new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ]);

    mockResolveMetadata.mockResolvedValue({
      authorizationServerUrl: 'https://github.com/login/oauth',
      authorizationServerMetadata: {
        issuer: 'https://github.com',
        authorization_endpoint: 'https://github.com/login/oauth/authorize',
        token_endpoint: 'https://github.com/login/oauth/access_token',
      },
      scopes: ['repo'],
      providerLabel: 'GitHub',
      telemetry: { resourceMetadataSource: 'header', serverMetadataSource: 'default' },
    });
    mockGetTokenForServer.mockResolvedValue('oauth-issued-token');

    const transport = new VscodeHttpTransport({
      serverName: 'github',
      url: 'https://api.githubcopilot.com/mcp/',
      headers: { Authorization: 'Bearer ghp_expired_or_revoked' },
    });

    await transport.start();
    await transport.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }));

    // First POST: PAT was sent (then server rejected it).
    expect(capturedPostHeaders[0]?.Authorization).toBe('Bearer ghp_expired_or_revoked');
    // OAuth machinery was invoked because of the 401.
    expect(mockResolveMetadata).toHaveBeenCalledTimes(1);
    expect(mockGetTokenForServer).toHaveBeenCalled();
    // Retry POST: stale PAT replaced with OAuth-issued token.
    expect(capturedPostHeaders[1]?.Authorization).toBe('Bearer oauth-issued-token');
  });

  it('post-OAuth 404 surfaces a helpful error and does NOT fall back to SSE', async () => {
    // Scenario: server demands OAuth via 401 + WWW-Authenticate, OAuth
    // succeeds, the retried POST gets a 404 (e.g. GitLab MCP returns 404
    // when the endpoint exists but the user's account/tier hasn't enabled
    // the feature). The transport must:
    //   1. NOT switch to SSE — the server clearly speaks Streamable HTTP,
    //      it just rejected this authenticated request semantically.
    //   2. Surface an error mentioning the URL and a tier/feature hint.
    let postCount = 0;
    let sseGetIssued = false;
    vi.spyOn(global, 'fetch' as any).mockImplementation((async (url: any, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'POST') {
        postCount++;
        if (postCount === 1) {
          return new Response('Unauthorized', {
            status: 401,
            headers: {
              'WWW-Authenticate': 'Bearer resource_metadata="https://gitlab.com/.well-known/oauth-protected-resource", scope="mcp"',
            },
          });
        }
        return new Response(JSON.stringify({ message: '404 Not Found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      // GET on the same URL is the SSE-fallback signature — record it
      // and 404 it. If the fix works, this should never be reached.
      sseGetIssued = true;
      return new Response('', { status: 404 });
    }) as any);

    mockResolveMetadata.mockResolvedValue({
      authorizationServerUrl: 'https://gitlab.com',
      authorizationServerMetadata: {
        issuer: 'https://gitlab.com',
        authorization_endpoint: 'https://gitlab.com/oauth/authorize',
        token_endpoint: 'https://gitlab.com/oauth/token',
      },
      scopes: ['mcp'],
      providerLabel: 'GitLab',
      telemetry: { resourceMetadataSource: 'wellKnown', serverMetadataSource: 'resourceMetadata' },
    });
    mockGetTokenForServer.mockResolvedValue('oauth-issued-token');

    const transport = new VscodeHttpTransport({
      serverName: 'gitlab',
      url: 'https://gitlab.com/api/v4/mcp',
      headers: {},
    });

    await transport.start();
    await expect(
      transport.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })),
    ).rejects.toThrow(/404 status from https:\/\/gitlab\.com\/api\/v4\/mcp after successful sign-in.*not available for your account/);

    expect(sseGetIssued).toBe(false);
    expect(postCount).toBe(2);
  });

  it('pre-auth 404 still falls back to SSE (legacy SSE-only servers)', async () => {
    // Server that has never issued an OAuth challenge: a 404 on the
    // initial POST is a legitimate "I'm an SSE server, not Streamable
    // HTTP" signal. Verify the fallback still triggers in that case.
    let postCount = 0;
    let sseGetIssued = false;
    vi.spyOn(global, 'fetch' as any).mockImplementation((async (_url: any, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'POST') {
        postCount++;
        return new Response('Not found', { status: 404 });
      }
      sseGetIssued = true;
      return new Response('', { status: 404 });
    }) as any);

    const transport = new VscodeHttpTransport({
      serverName: 'legacy-sse',
      url: 'https://example.com/sse-only',
      headers: {},
    });

    await transport.start();
    // _sseFallbackWithMessage handles errors by setting transport state to
    // 'error' rather than throwing, so .send() resolves either way. The
    // important assertion is that the SSE GET was attempted, proving the
    // fallback path ran.
    await transport.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }));

    // Backward compat: SSE GET was attempted because no auth challenge
    // was ever observed.
    expect(sseGetIssued).toBe(true);
    expect(postCount).toBe(1);
    // OAuth path was never invoked — there was no challenge.
    expect(mockResolveMetadata).not.toHaveBeenCalled();
  });
});
