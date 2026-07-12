/**
 * Tests for performOAuthFlow — the full authorize → callback → exchange flow.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { McpServerConfig } from '../../../userDataADO/types/profile';

// ─── Mocks ───────────────────────────────────────────────────────────────────

const sdkAuthMock = vi.fn();

vi.mock('@modelcontextprotocol/sdk/client/auth.js', () => ({
  auth: (...args: any[]) => sdkAuthMock(...args),
}));

vi.mock('electron', () => ({
  shell: { openExternal: vi.fn(async () => true) },
}));

const callbackServer = {
  ensureRunning: vi.fn(async () => undefined),
  getRedirectUri: vi.fn(() => 'http://127.0.0.1:33420/callback'),
  waitForCode: vi.fn(async () => 'auth-code-123'),
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

// Stub well-known synthetic fetch — pass through to real globalThis.fetch
vi.mock('../wellKnownOAuthProviders', async (importOriginal) => {
  const real = await importOriginal<any>();
  return {
    ...real,
    createSyntheticMetadataFetch: (f: typeof fetch) => f,
  };
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

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
  callbackServer.waitForCode.mockClear();
  callbackServer.waitForCode.mockResolvedValue('auth-code-123');
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('performOAuthFlow', () => {
  it('returns immediately when first sdkAuth call returns AUTHORIZED (cached tokens)', async () => {
    sdkAuthMock.mockResolvedValueOnce('AUTHORIZED');
    const { performOAuthFlow } = await import('../performOAuthFlow');
    const { OpenKosmosOAuthProvider } = await import('../OpenKosmosOAuthProvider');
    const provider = new OpenKosmosOAuthProvider('s', makeCfg());

    await expect(performOAuthFlow(provider, 's', 'https://api.example.com/mcp')).resolves.toBeUndefined();
    expect(sdkAuthMock).toHaveBeenCalledTimes(1);
    expect(callbackServer.waitForCode).not.toHaveBeenCalled();
  });

  it('completes full redirect flow (REDIRECT → waitForCode → AUTHORIZED)', async () => {
    sdkAuthMock
      .mockResolvedValueOnce('REDIRECT')      // first call: needs redirect
      .mockResolvedValueOnce('AUTHORIZED');    // second call: code exchanged

    const { performOAuthFlow } = await import('../performOAuthFlow');
    const { OpenKosmosOAuthProvider } = await import('../OpenKosmosOAuthProvider');
    const provider = new OpenKosmosOAuthProvider('s', makeCfg());

    await expect(performOAuthFlow(provider, 's', 'https://api.example.com/mcp')).resolves.toBeUndefined();
    expect(sdkAuthMock).toHaveBeenCalledTimes(2);
    expect(callbackServer.waitForCode).toHaveBeenCalledTimes(1);
  });

  it('throws MCP_OAUTH_FLOW_FAILED when second sdkAuth returns unexpected result', async () => {
    sdkAuthMock
      .mockResolvedValueOnce('REDIRECT')
      .mockResolvedValueOnce('REDIRECT');  // unexpected second REDIRECT

    const { performOAuthFlow } = await import('../performOAuthFlow');
    const { OpenKosmosOAuthProvider } = await import('../OpenKosmosOAuthProvider');
    const provider = new OpenKosmosOAuthProvider('s', makeCfg());

    await expect(performOAuthFlow(provider, 's', 'https://api.example.com/mcp'))
      .rejects.toThrow('MCP_OAUTH_FLOW_FAILED');
  });

  it('throws MCP_AUTH_CANCELLED for pre-aborted signal', async () => {
    const ctrl = new AbortController();
    ctrl.abort();

    const { performOAuthFlow } = await import('../performOAuthFlow');
    const { OpenKosmosOAuthProvider } = await import('../OpenKosmosOAuthProvider');
    const provider = new OpenKosmosOAuthProvider('s', makeCfg());

    await expect(
      performOAuthFlow(provider, 's', 'https://api.example.com/mcp', { signal: ctrl.signal }),
    ).rejects.toThrow('MCP_AUTH_CANCELLED');
    expect(sdkAuthMock).not.toHaveBeenCalled();
  });

  it('throws MCP_OAUTH_FLOW_FAILED when ensureRunning throws', async () => {
    callbackServer.ensureRunning.mockRejectedValueOnce(new Error('Port already in use'));

    const { performOAuthFlow } = await import('../performOAuthFlow');
    const { OpenKosmosOAuthProvider } = await import('../OpenKosmosOAuthProvider');
    const provider = new OpenKosmosOAuthProvider('s', makeCfg());

    await expect(performOAuthFlow(provider, 's', 'https://api.example.com/mcp'))
      .rejects.toThrow('MCP_OAUTH_FLOW_FAILED');
  });

  it('throws MCP_DCR_REQUIRES_USER_CLIENT_ID when SDK throws DCR unsupported', async () => {
    sdkAuthMock.mockRejectedValueOnce(
      new Error('Provider does not support dynamic client registration'),
    );

    const { performOAuthFlow } = await import('../performOAuthFlow');
    const { OpenKosmosOAuthProvider } = await import('../OpenKosmosOAuthProvider');
    const provider = new OpenKosmosOAuthProvider('s', makeCfg());

    await expect(performOAuthFlow(provider, 's', 'https://api.example.com/mcp'))
      .rejects.toThrow('MCP_DCR_REQUIRES_USER_CLIENT_ID');
  });

  it('throws MCP_DCR_REQUIRES_USER_CLIENT_ID for the other DCR error message', async () => {
    sdkAuthMock.mockRejectedValueOnce(
      new Error('Client information must be saveable for dynamic registration'),
    );

    const { performOAuthFlow } = await import('../performOAuthFlow');
    const { OpenKosmosOAuthProvider } = await import('../OpenKosmosOAuthProvider');
    const provider = new OpenKosmosOAuthProvider('s', makeCfg());

    await expect(performOAuthFlow(provider, 's', 'https://api.example.com/mcp'))
      .rejects.toThrow('MCP_DCR_REQUIRES_USER_CLIENT_ID');
  });

  it('throws MCP_DCR_RESTRICTED when DCR is restricted to approved partners', async () => {
    sdkAuthMock.mockRejectedValueOnce(
      new Error('Dynamic client registration is restricted to approved partners. To integrate with Lovable, contact us at https://lovable.dev/support or use the client_id_metadata_document discovery flow instead.'),
    );

    const { performOAuthFlow } = await import('../performOAuthFlow');
    const { OpenKosmosOAuthProvider } = await import('../OpenKosmosOAuthProvider');
    const provider = new OpenKosmosOAuthProvider('s', makeCfg());

    await expect(performOAuthFlow(provider, 's', 'https://api.example.com/mcp'))
      .rejects.toThrow('MCP_DCR_RESTRICTED');
  });

  it('throws MCP_OAUTH_FLOW_FAILED for generic SDK throw', async () => {
    sdkAuthMock.mockRejectedValueOnce(new Error('Unexpected server error'));

    const { performOAuthFlow } = await import('../performOAuthFlow');
    const { OpenKosmosOAuthProvider } = await import('../OpenKosmosOAuthProvider');
    const provider = new OpenKosmosOAuthProvider('s', makeCfg());

    await expect(performOAuthFlow(provider, 's', 'https://api.example.com/mcp'))
      .rejects.toThrow('MCP_OAUTH_FLOW_FAILED');
  });

  it('normalizes a non-Error SDK failure', async () => {
    sdkAuthMock.mockRejectedValueOnce('upstream unavailable');
    const { performOAuthFlow } = await import('../performOAuthFlow');
    const { OpenKosmosOAuthProvider } = await import('../OpenKosmosOAuthProvider');

    await expect(
      performOAuthFlow(
        new OpenKosmosOAuthProvider('s', makeCfg()),
        's',
        'https://api.example.com/mcp',
      ),
    ).rejects.toThrow('MCP_OAUTH_FLOW_FAILED');
  });

  it('throws MCP_AUTH_CANCELLED when signal is aborted after first sdkAuth throw', async () => {
    const ctrl = new AbortController();
    sdkAuthMock.mockImplementationOnce(async () => {
      ctrl.abort();
      throw new Error('Some error');
    });

    const { performOAuthFlow } = await import('../performOAuthFlow');
    const { OpenKosmosOAuthProvider } = await import('../OpenKosmosOAuthProvider');
    const provider = new OpenKosmosOAuthProvider('s', makeCfg());

    await expect(
      performOAuthFlow(provider, 's', 'https://api.example.com/mcp', { signal: ctrl.signal }),
    ).rejects.toThrow('MCP_AUTH_CANCELLED');
  });

  it('throws MCP_OAUTH_FLOW_FAILED when waitForCode fails', async () => {
    sdkAuthMock.mockResolvedValueOnce('REDIRECT');
    callbackServer.waitForCode.mockRejectedValueOnce(new Error('Callback timed out'));

    const { performOAuthFlow } = await import('../performOAuthFlow');
    const { OpenKosmosOAuthProvider } = await import('../OpenKosmosOAuthProvider');
    const provider = new OpenKosmosOAuthProvider('s', makeCfg());

    await expect(performOAuthFlow(provider, 's', 'https://api.example.com/mcp'))
      .rejects.toThrow('MCP_OAUTH_FLOW_FAILED');
  });

  it('throws MCP_AUTH_CANCELLED when signal aborts during waitForCode failure', async () => {
    const ctrl = new AbortController();
    sdkAuthMock.mockResolvedValueOnce('REDIRECT');
    callbackServer.waitForCode.mockImplementationOnce(async () => {
      ctrl.abort();
      throw new Error('Timeout');
    });

    const { performOAuthFlow } = await import('../performOAuthFlow');
    const { OpenKosmosOAuthProvider } = await import('../OpenKosmosOAuthProvider');
    const provider = new OpenKosmosOAuthProvider('s', makeCfg());

    await expect(
      performOAuthFlow(provider, 's', 'https://api.example.com/mcp', { signal: ctrl.signal }),
    ).rejects.toThrow('MCP_AUTH_CANCELLED');
  });

  it('throws MCP_AUTH_CANCELLED when signal aborts during second sdkAuth call', async () => {
    const ctrl = new AbortController();
    sdkAuthMock
      .mockResolvedValueOnce('REDIRECT')
      .mockImplementationOnce(async () => {
        ctrl.abort();
        throw new Error('Aborted');
      });

    const { performOAuthFlow } = await import('../performOAuthFlow');
    const { OpenKosmosOAuthProvider } = await import('../OpenKosmosOAuthProvider');
    const provider = new OpenKosmosOAuthProvider('s', makeCfg());

    await expect(
      performOAuthFlow(provider, 's', 'https://api.example.com/mcp', { signal: ctrl.signal }),
    ).rejects.toThrow('MCP_AUTH_CANCELLED');
  });
});

describe('runRefreshOnly', () => {
  it('refreshes cached credentials without opening an authorization page', async () => {
    sdkAuthMock.mockResolvedValueOnce('AUTHORIZED');
    const { runRefreshOnly } = await import('../performOAuthFlow');
    const { OpenKosmosOAuthProvider } = await import('../OpenKosmosOAuthProvider');
    const provider = new OpenKosmosOAuthProvider('s', makeCfg());

    await expect(runRefreshOnly(provider, 's', 'https://api.example.com/mcp')).resolves.toBeUndefined();
    expect(sdkAuthMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ serverUrl: 'https://api.example.com/mcp' }),
    );
  });

  it('rejects before contacting the SDK when already aborted', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const { runRefreshOnly } = await import('../performOAuthFlow');
    const { OpenKosmosOAuthProvider } = await import('../OpenKosmosOAuthProvider');

    await expect(
      runRefreshOnly(new OpenKosmosOAuthProvider('s', makeCfg()), 's', makeCfg().url!, {
        signal: ctrl.signal,
      }),
    ).rejects.toThrow('MCP_AUTH_CANCELLED');
    expect(sdkAuthMock).not.toHaveBeenCalled();
  });

  it('converts an SDK failure after abort into cancellation', async () => {
    const ctrl = new AbortController();
    sdkAuthMock.mockImplementationOnce(async () => {
      ctrl.abort();
      throw new Error('network stopped');
    });
    const { runRefreshOnly } = await import('../performOAuthFlow');
    const { OpenKosmosOAuthProvider } = await import('../OpenKosmosOAuthProvider');

    await expect(
      runRefreshOnly(new OpenKosmosOAuthProvider('s', makeCfg()), 's', makeCfg().url!, {
        signal: ctrl.signal,
      }),
    ).rejects.toThrow('MCP_AUTH_CANCELLED');
  });

  it('preserves ordinary SDK failures and rejects an unexpected redirect result', async () => {
    const { runRefreshOnly } = await import('../performOAuthFlow');
    const { OpenKosmosOAuthProvider } = await import('../OpenKosmosOAuthProvider');
    const provider = new OpenKosmosOAuthProvider('s', makeCfg());

    sdkAuthMock.mockRejectedValueOnce(new Error('refresh endpoint unavailable'));
    await expect(runRefreshOnly(provider, 's', makeCfg().url!))
      .rejects.toThrow('refresh endpoint unavailable');

    sdkAuthMock.mockResolvedValueOnce('REDIRECT');
    await expect(runRefreshOnly(provider, 's', makeCfg().url!))
      .rejects.toThrow('REFRESH_ONLY: unexpected SDK result');
  });

  it('binds provider methods while suppressing browser redirects', async () => {
    sdkAuthMock.mockImplementationOnce(async (refreshProvider: any) => {
      expect(typeof refreshProvider.state).toBe('function');
      await refreshProvider.state();
      expect(refreshProvider.pinnedCallbackPort).toBe(33420);
      await refreshProvider.redirectToAuthorization(new URL('https://identity.example.com'));
      return 'AUTHORIZED';
    });
    const { runRefreshOnly } = await import('../performOAuthFlow');
    const { OpenKosmosOAuthProvider } = await import('../OpenKosmosOAuthProvider');

    await expect(
      runRefreshOnly(new OpenKosmosOAuthProvider('s', makeCfg()), 's', makeCfg().url!),
    ).rejects.toThrow('REFRESH_ONLY: SDK attempted to open browser');
  });
});
