// @ts-nocheck
/**
 * McpAuthService.coverage3.test.ts
 *
 * Targets remaining uncovered branches in McpAuthService (35 statements, 90.65%):
 *  - _performGenericOAuth: proactive refresh window path (runRefreshOnly success)
 *  - _performGenericOAuth: proactive refresh path where runRefreshOnly throws non-cancel error (fall through)
 *  - _performGenericOAuth: runRefreshOnly throws cancel error (re-throws)
 *  - _performGenericOAuth: DCR error → user provides clientId → retry succeeds
 *  - _performGenericOAuth: DCR error → user provides clientId → retry fails non-cancel
 *  - requestClientIdFromUser: signal already aborted before dispatch
 *  - requestClientIdFromUser: signal abort after dispatch
 *  - requestConsent: timeout path (very short timeout)
 *  - onInteraction listener error suppression
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { McpServerConfig } from '../../../userDataADO/types/profile';
import type { McpResolvedAuthMetadata } from '../types';
import { createMcpAuthCancelledError, createMcpDcrRequiresUserClientIdError } from '../errors';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockWebContents = { send: vi.fn(), getURL: vi.fn(() => 'https://app.local/agents') };
const mockWindow = {
  webContents: mockWebContents,
  isDestroyed: vi.fn(() => false),
  getParentWindow: vi.fn(() => null),
  getTitle: vi.fn(() => 'OpenKosmos'),
};
const mockGetAllWindows = vi.fn(() => [] as any[]);

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: (...a: any[]) => mockGetAllWindows(...a) },
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

const performOAuthFlowMock = vi.fn(async () => undefined);
const runRefreshOnlyMock = vi.fn(async () => undefined);
vi.mock('../performOAuthFlow', () => ({
  performOAuthFlow: (...args: any[]) => performOAuthFlowMock(...args),
  runRefreshOnly: (...args: any[]) => runRefreshOnlyMock(...args),
}));

let storeImpl: Record<string, any> = {};
const cacheMock = {
  getMcpOAuth: vi.fn(async (key: string) => storeImpl[key] ?? null),
  setMcpOAuth: vi.fn(async (key: string, entry: any) => { storeImpl[key] = entry; }),
  deleteMcpOAuth: vi.fn(async (key: string) => { delete storeImpl[key]; }),
};
vi.mock('../OpenKosmosTokenCache', () => ({
  OpenKosmosTokenCache: { getInstance: () => cacheMock },
}));

vi.mock('../../unifiedLogger', () => ({
  getUnifiedLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const isKnownToNotSupportDcrMock = vi.fn(() => false);
vi.mock('../wellKnownOAuthProviders', async (importOriginal) => {
  const real = await importOriginal<any>();
  return { ...real, isKnownToNotSupportDcr: (...args: any[]) => isKnownToNotSupportDcrMock(...args) };
});

const fallbackState = vi.hoisted(() => ({ label: 'TestProvider' as string | undefined }));
vi.mock('../dcrFallbackInstructions', () => ({
  getProviderHelp: vi.fn(() => ({ label: fallbackState.label, steps: [] })),
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import { McpAuthService } from '../McpAuthService';
import { mcpAuthPromptRegistry } from '../mcpAuthPromptRegistry';
import { getMcpOAuthServerKey } from '../serverKey';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeCfg(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    name: 'test-server',
    transport: 'StreamableHttp',
    command: '',
    args: [],
    env: {},
    url: 'https://api.example.com/mcp',
    in_use: true,
    ...overrides,
  };
}

function makeGenericMetadata(overrides: Partial<McpResolvedAuthMetadata> = {}): McpResolvedAuthMetadata {
  return {
    authorizationServerUrl: 'https://auth.example.com',
    authorizationServerMetadata: { issuer: 'https://auth.example.com' },
    scopes: ['read', 'write'],
    providerLabel: 'TestProvider',
    telemetry: { resourceMetadataSource: 'none', serverMetadataSource: 'default' },
    ...overrides,
  };
}

async function waitForIpc(channel: string): Promise<any[]> {
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    const call = mockWebContents.send.mock.calls.find(c => c[0] === channel);
    if (call) return call;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error(`${channel} was not dispatched`);
}

beforeEach(() => {
  storeImpl = {};
  performOAuthFlowMock.mockReset();
  runRefreshOnlyMock.mockReset();
  callbackServer.ensureRunning.mockClear();
  callbackServer.getRedirectUri.mockClear();
  mockGetAllWindows.mockReturnValue([]);
  mockWebContents.send.mockClear();
  mockWebContents.getURL.mockReturnValue('https://app.local/agents');
  mockWindow.isDestroyed.mockReturnValue(false);
  mockWindow.getParentWindow.mockReturnValue(null);
  mockWindow.getTitle.mockReturnValue('OpenKosmos');
  isKnownToNotSupportDcrMock.mockReturnValue(false);
  fallbackState.label = 'TestProvider';
  cacheMock.getMcpOAuth.mockImplementation(async (key: string) => storeImpl[key] ?? null);
  cacheMock.setMcpOAuth.mockImplementation(async (key: string, entry: any) => { storeImpl[key] = entry; });
  cacheMock.deleteMcpOAuth.mockImplementation(async (key: string) => { delete storeImpl[key]; });
  mcpAuthPromptRegistry.__resetForTests();
  (McpAuthService as any).instance = null;
  (McpAuthService as any).interactionListeners = new Set();
});

// ─── Proactive refresh: runRefreshOnly succeeds ───────────────────────────────

describe('McpAuthService — _performGenericOAuth proactive refresh success', () => {
  it('returns refreshed access_token when runRefreshOnly succeeds', async () => {
    const cfg = makeCfg();
    const key = getMcpOAuthServerKey('test-server', cfg);

    // Token is in the proactive refresh window (expires_in = 5 < PROACTIVE_REFRESH_WINDOW_SEC=300)
    storeImpl[key] = {
      accessToken: 'old-at',
      refreshToken: 'rt',
      expiresAt: Date.now() + 5 * 1000, // nearly expired
      scope: 'read write',
      clientId: undefined,
    };

    // runRefreshOnly succeeds; afterwards the cache has a fresh token
    runRefreshOnlyMock.mockImplementation(async () => {
      storeImpl[key] = {
        accessToken: 'refreshed-at',
        refreshToken: 'new-rt',
        expiresAt: Date.now() + 3600_000,
        scope: 'read write',
        clientId: undefined,
      };
    });

    const service = McpAuthService.getInstance();
    const result = await service.getTokenForServer('test-server', makeGenericMetadata(), { cfg });
    expect(result).toBe('refreshed-at');
    expect(runRefreshOnlyMock).toHaveBeenCalled();
    expect(performOAuthFlowMock).not.toHaveBeenCalled();
  });
});

// ─── Proactive refresh: runRefreshOnly fails non-cancel → fall through ─────────

describe('McpAuthService — _performGenericOAuth proactive refresh fallthrough', () => {
  it('falls through to interactive flow when runRefreshOnly fails with transient error', async () => {
    const cfg = makeCfg();
    const key = getMcpOAuthServerKey('test-server', cfg);

    // Token in proactive refresh window with a refresh token
    storeImpl[key] = {
      accessToken: 'near-expired-at',
      refreshToken: 'rt',
      expiresAt: Date.now() + 5 * 1000,
      scope: 'read write',
      clientId: undefined,
    };

    // runRefreshOnly throws a transient error (non-cancel)
    runRefreshOnlyMock.mockRejectedValue(new Error('transient DNS error'));

    // After fall-through, consent is required but no window → cancel → throw
    const service = McpAuthService.getInstance();
    await expect(
      service.getTokenForServer('test-server', makeGenericMetadata(), { cfg }),
    ).rejects.toThrow('MCP_AUTH_CANCELLED');

    expect(runRefreshOnlyMock).toHaveBeenCalled();
  });
});

// ─── Proactive refresh: runRefreshOnly throws cancel error → re-throw ─────────

describe('McpAuthService — _performGenericOAuth proactive refresh cancel re-throw', () => {
  it('re-throws cancel error from runRefreshOnly', async () => {
    const cfg = makeCfg();
    const key = getMcpOAuthServerKey('test-server', cfg);

    storeImpl[key] = {
      accessToken: 'near-expired-at',
      refreshToken: 'rt',
      expiresAt: Date.now() + 5 * 1000,
      scope: 'read write',
      clientId: undefined,
    };

    runRefreshOnlyMock.mockRejectedValue(
      createMcpAuthCancelledError('test-server'),
    );

    const service = McpAuthService.getInstance();
    await expect(
      service.getTokenForServer('test-server', makeGenericMetadata(), { cfg }),
    ).rejects.toThrow('MCP_AUTH_CANCELLED');
  });
});

// ─── DCR error → user provides clientId → retry succeeds ──────────────────────

describe('McpAuthService — _performGenericOAuth DCR retry success', () => {
  it('retries flow after user provides clientId and succeeds', async () => {
    const cfg = makeCfg();
    const key = getMcpOAuthServerKey('test-server', cfg);

    mockGetAllWindows.mockReturnValue([mockWindow]);

    // First OAuth flow throws DCR error
    performOAuthFlowMock.mockRejectedValueOnce(
      createMcpDcrRequiresUserClientIdError('test-server'),
    );

    // Second call (retry) succeeds
    performOAuthFlowMock.mockImplementationOnce(async () => {
      storeImpl[key] = {
        accessToken: 'retry-tok',
        refreshToken: null,
        expiresAt: Date.now() + 3600_000,
        scope: 'read write',
        clientId: 'user-client-id',
      };
    });

    const service = McpAuthService.getInstance();

    // Start the token request
    const p = service.getTokenForServer('test-server', makeGenericMetadata(), { cfg });

    // Need to: 1) resolve consent, 2) resolve client-id dialog
    const deadline = Date.now() + 1000;

    // Step 1: resolve consent
    let consentResolved = false;
    while (Date.now() < deadline && !consentResolved) {
      await new Promise(r => setTimeout(r, 15));
      const call = mockWebContents.send.mock.calls.find(c => c[0] === 'mcpAuth:showConsent');
      if (call) {
        const handler = mcpAuthPromptRegistry.takeConsent(call[1].requestId);
        if (handler) { handler('allow-this-time'); consentResolved = true; }
      }
    }

    // Step 2: resolve client-id dialog
    let clientIdResolved = false;
    while (Date.now() < deadline && !clientIdResolved) {
      await new Promise(r => setTimeout(r, 15));
      const call = mockWebContents.send.mock.calls.find(c => c[0] === 'mcpAuth:requestClientId');
      if (call) {
        const handler = mcpAuthPromptRegistry.takeClientId(call[1].requestId);
        if (handler) {
          handler({ clientId: 'user-client-id', clientSecret: undefined });
          clientIdResolved = true;
        }
      }
    }

    const result = await p;
    expect(result).toBe('retry-tok');
  });
});

// ─── DCR error → user provides clientId → retry fails ─────────────────────────

describe('McpAuthService — _performGenericOAuth DCR retry non-cancel failure', () => {
  it('throws when retry after user clientId also fails with non-cancel error', async () => {
    const cfg = makeCfg();
    mockGetAllWindows.mockReturnValue([mockWindow]);

    // First OAuth flow throws DCR error
    performOAuthFlowMock.mockRejectedValueOnce(
      createMcpDcrRequiresUserClientIdError('test-server'),
    );
    // Retry throws a different error
    performOAuthFlowMock.mockRejectedValueOnce(new Error('upstream 500'));

    const service = McpAuthService.getInstance();
    const p = service.getTokenForServer('test-server', makeGenericMetadata(), { cfg });

    const deadline = Date.now() + 1000;

    // Resolve consent
    let consentResolved = false;
    while (Date.now() < deadline && !consentResolved) {
      await new Promise(r => setTimeout(r, 15));
      const call = mockWebContents.send.mock.calls.find(c => c[0] === 'mcpAuth:showConsent');
      if (call) {
        const handler = mcpAuthPromptRegistry.takeConsent(call[1].requestId);
        if (handler) { handler('allow-this-time'); consentResolved = true; }
      }
    }

    // Resolve client-id dialog
    let clientIdResolved = false;
    while (Date.now() < deadline && !clientIdResolved) {
      await new Promise(r => setTimeout(r, 15));
      const call = mockWebContents.send.mock.calls.find(c => c[0] === 'mcpAuth:requestClientId');
      if (call) {
        const handler = mcpAuthPromptRegistry.takeClientId(call[1].requestId);
        if (handler) {
          handler({ clientId: 'user-client-id', clientSecret: undefined });
          clientIdResolved = true;
        }
      }
    }

    await expect(p).rejects.toThrow('upstream 500');
  });
});

// ─── requestClientIdFromUser: signal already aborted ─────────────────────────

describe('McpAuthService — requestClientIdFromUser signal already aborted', () => {
  it('resolves cancelled immediately when signal is pre-aborted', async () => {
    mockGetAllWindows.mockReturnValue([mockWindow]);
    isKnownToNotSupportDcrMock.mockReturnValue(true);

    const ctrl = new AbortController();
    ctrl.abort(); // Already aborted before the call

    const service = McpAuthService.getInstance();
    await expect(
      service.getTokenForServer('test-server', makeGenericMetadata(), {
        cfg: makeCfg(),
        signal: ctrl.signal,
      }),
    ).rejects.toThrow('MCP_AUTH_CANCELLED');
  });
});

// ─── onInteraction: listener error is suppressed ──────────────────────────────

describe('McpAuthService — onInteraction listener error suppression', () => {
  it('does not throw when an interaction listener throws', async () => {
    mockGetAllWindows.mockReturnValue([mockWindow]);
    const throwingListener = vi.fn(() => { throw new Error('listener bomb'); });
    McpAuthService.onInteraction(throwingListener as any);

    const service = McpAuthService.getInstance();
    const p = service.getTokenForServer('test-server', makeGenericMetadata(), { cfg: makeCfg() });

    // resolve consent to avoid hanging
    const deadline = Date.now() + 500;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 10));
      const call = mockWebContents.send.mock.calls.find(c => c[0] === 'mcpAuth:showConsent');
      if (call) {
        const handler = mcpAuthPromptRegistry.takeConsent(call[1].requestId);
        if (handler) { handler('cancel'); break; }
      }
    }

    await expect(p).rejects.toThrow('MCP_AUTH_CANCELLED');
    // The throwing listener was called but the error was swallowed
    expect(throwingListener).toHaveBeenCalled();
  });
});

// ─── requestConsent timeout (very short) ─────────────────────────────────────

describe('McpAuthService — requestConsent timeout', () => {
  it('resolves as cancel when consent times out', async () => {
    mockGetAllWindows.mockReturnValue([mockWindow]);

    const service = McpAuthService.getInstance();

    // Invoke requestConsent directly with a 1ms timeout so it expires immediately
    const result = await (service as any).requestConsent('test-srv', 'TestProvider', { timeoutMs: 1 });
    expect(result).toBe('cancel');
  });
});

// ─── requestClientIdFromUser timeout ──────────────────────────────────────────

describe('McpAuthService — requestClientIdFromUser timeout', () => {
  it('resolves as cancelled when client-id dialog times out', async () => {
    mockGetAllWindows.mockReturnValue([mockWindow]);
    isKnownToNotSupportDcrMock.mockReturnValue(true);

    const service = McpAuthService.getInstance();

    // Invoke directly with 1ms timeout
    const result = await (service as any).requestClientIdFromUser(
      {
        serverName: 'test-srv',
        metadata: makeGenericMetadata(),
        cfg: makeCfg(),
        redirectUri: 'http://localhost/callback',
      },
      { timeoutMs: 1 },
    );
    expect(result).toEqual({ cancelled: true });
  });
});

describe('McpAuthService — provider-neutral routing and deduplication', () => {
  it('returns undefined without cfg and returns a fresh cached token without interaction', async () => {
    const service = McpAuthService.getInstance();
    expect(await service.getTokenForServer('missing-cfg', makeGenericMetadata())).toBeUndefined();

    const cfg = makeCfg();
    const key = getMcpOAuthServerKey('test-server', cfg);
    storeImpl[key] = {
      serverName: 'test-server',
      serverUrl: cfg.url,
      accessToken: 'fresh-token',
      expiresAt: Date.now() + 3600_000,
    };
    expect(await service.getTokenForServer('test-server', makeGenericMetadata(), { cfg }))
      .toBe('fresh-token');
    expect(mockWebContents.send).not.toHaveBeenCalled();
  });

  it('shares one consent interaction between concurrent callers', async () => {
    mockGetAllWindows.mockReturnValue([mockWindow]);
    const service = McpAuthService.getInstance();
    const options = { cfg: makeCfg() };
    const first = service.getTokenForServer('test-server', makeGenericMetadata(), options);
    const second = service.getTokenForServer('test-server', makeGenericMetadata(), options);
    const call = await waitForIpc('mcpAuth:showConsent');
    mcpAuthPromptRegistry.takeConsent(call[1].requestId)?.('cancel');

    await expect(first).rejects.toThrow('MCP_AUTH_CANCELLED');
    await expect(second).rejects.toThrow('MCP_AUTH_CANCELLED');
    expect(mockWebContents.send.mock.calls.filter(c => c[0] === 'mcpAuth:showConsent')).toHaveLength(1);
  });

  it('force refresh expires the cached token, obtains consent, and returns the flow result', async () => {
    mockGetAllWindows.mockReturnValue([mockWindow]);
    const cfg = makeCfg();
    const key = getMcpOAuthServerKey('test-server', cfg);
    storeImpl[key] = {
      serverName: 'test-server',
      serverUrl: cfg.url,
      accessToken: 'old-token',
      refreshToken: 'refresh',
      expiresAt: Date.now() + 3600_000,
    };
    performOAuthFlowMock.mockImplementation(async () => {
      expect(storeImpl[key].expiresAt).toBe(0);
      storeImpl[key] = { ...storeImpl[key], accessToken: 'forced-token', expiresAt: Date.now() + 3600_000 };
    });

    const pending = McpAuthService.getInstance().getTokenForServer(
      'test-server',
      makeGenericMetadata(),
      { cfg, forceRefresh: true },
    );
    const call = await waitForIpc('mcpAuth:showConsent');
    mcpAuthPromptRegistry.takeConsent(call[1].requestId)?.('allow-this-time');

    await expect(pending).resolves.toBe('forced-token');
    expect(performOAuthFlowMock).toHaveBeenCalledOnce();
  });
});

describe('McpAuthService — provider-neutral fallback failures', () => {
  it('propagates callback-server startup failures for known no-DCR providers', async () => {
    isKnownToNotSupportDcrMock.mockReturnValue(true);
    callbackServer.ensureRunning.mockRejectedValueOnce(new Error('port unavailable'));
    await expect(McpAuthService.getInstance().getTokenForServer(
      'test-server',
      makeGenericMetadata(),
      { cfg: makeCfg() },
    )).rejects.toThrow('port unavailable');
  });

  it('preserves a non-Error callback-server startup failure', async () => {
    isKnownToNotSupportDcrMock.mockReturnValue(true);
    callbackServer.ensureRunning.mockRejectedValueOnce('port unavailable');
    await expect(McpAuthService.getInstance().getTokenForServer(
      'test-server',
      makeGenericMetadata(),
      { cfg: makeCfg() },
    )).rejects.toBe('port unavailable');
  });

  it('accepts a user-provided client, then completes consent and OAuth', async () => {
    isKnownToNotSupportDcrMock.mockReturnValue(true);
    mockGetAllWindows.mockReturnValue([mockWindow]);
    const cfg = makeCfg();
    const key = getMcpOAuthServerKey('test-server', cfg);
    performOAuthFlowMock.mockImplementation(async () => {
      storeImpl[key] = {
        ...storeImpl[key],
        accessToken: 'provider-token',
        expiresAt: Date.now() + 3600_000,
      };
    });

    const pending = McpAuthService.getInstance().getTokenForServer(
      'test-server',
      makeGenericMetadata(),
      { cfg },
    );
    const clientCall = await waitForIpc('mcpAuth:requestClientId');
    mcpAuthPromptRegistry.takeClientId(clientCall[1].requestId)?.({
      clientId: 'registered-client',
      clientSecret: 'registered-secret',
    });
    const consentCall = await waitForIpc('mcpAuth:showConsent');
    mcpAuthPromptRegistry.takeConsent(consentCall[1].requestId)?.('allow-this-time');

    await expect(pending).resolves.toBe('provider-token');
    expect(storeImpl[key]).toMatchObject({
      clientId: 'registered-client',
      clientSecret: 'registered-secret',
    });
  });

  it('treats malformed or cancelled client-id responses as cancellation', async () => {
    isKnownToNotSupportDcrMock.mockReturnValue(true);
    mockGetAllWindows.mockReturnValue([mockWindow]);
    const service = McpAuthService.getInstance();

    const malformed = service.getTokenForServer('test-server', makeGenericMetadata(), { cfg: makeCfg() });
    let call = await waitForIpc('mcpAuth:requestClientId');
    mcpAuthPromptRegistry.takeClientId(call[1].requestId)?.({} as any);
    await expect(malformed).rejects.toThrow('MCP_AUTH_CANCELLED');

    mockWebContents.send.mockClear();
    const cancelled = service.getTokenForServer('test-server', makeGenericMetadata(), { cfg: makeCfg() });
    call = await waitForIpc('mcpAuth:requestClientId');
    mcpAuthPromptRegistry.takeClientId(call[1].requestId)?.({ cancelled: true });
    await expect(cancelled).rejects.toThrow('MCP_AUTH_CANCELLED');
  });

  it('rethrows initial cancellation and ordinary OAuth failures after consent', async () => {
    mockGetAllWindows.mockReturnValue([mockWindow]);
    const service = McpAuthService.getInstance();

    performOAuthFlowMock.mockRejectedValueOnce(createMcpAuthCancelledError('test-server'));
    let pending = service.getTokenForServer('test-server', makeGenericMetadata(), { cfg: makeCfg() });
    let call = await waitForIpc('mcpAuth:showConsent');
    mcpAuthPromptRegistry.takeConsent(call[1].requestId)?.('allow-this-time');
    await expect(pending).rejects.toThrow('MCP_AUTH_CANCELLED');

    mockWebContents.send.mockClear();
    performOAuthFlowMock.mockRejectedValueOnce('non-error failure');
    pending = service.getTokenForServer('test-server', makeGenericMetadata(), { cfg: makeCfg() });
    call = await waitForIpc('mcpAuth:showConsent');
    mcpAuthPromptRegistry.takeConsent(call[1].requestId)?.('allow-this-time');
    await expect(pending).rejects.toBe('non-error failure');
  });

  it('rethrows cancellation from the retry after the DCR fallback', async () => {
    mockGetAllWindows.mockReturnValue([mockWindow]);
    performOAuthFlowMock
      .mockRejectedValueOnce(createMcpDcrRequiresUserClientIdError('test-server'))
      .mockRejectedValueOnce(createMcpAuthCancelledError('test-server'));
    const pending = McpAuthService.getInstance().getTokenForServer(
      'test-server',
      makeGenericMetadata(),
      { cfg: makeCfg() },
    );
    let call = await waitForIpc('mcpAuth:showConsent');
    mcpAuthPromptRegistry.takeConsent(call[1].requestId)?.('allow-this-time');
    call = await waitForIpc('mcpAuth:requestClientId');
    mcpAuthPromptRegistry.takeClientId(call[1].requestId)?.({ clientId: 'manual-client' });
    await expect(pending).rejects.toThrow('MCP_AUTH_CANCELLED');
  });

  it('handles non-Error refresh and retry failures without hiding the original value', async () => {
    const cfg = makeCfg();
    const key = getMcpOAuthServerKey('test-server', cfg);
    storeImpl[key] = {
      serverName: 'test-server',
      serverUrl: cfg.url,
      accessToken: 'near-expiry',
      refreshToken: 'refresh',
      expiresAt: Date.now() + 1000,
    };
    runRefreshOnlyMock.mockRejectedValueOnce('refresh failed');
    await expect(McpAuthService.getInstance().getTokenForServer(
      'test-server',
      makeGenericMetadata(),
      { cfg },
    )).rejects.toThrow('MCP_AUTH_CANCELLED');

    mockGetAllWindows.mockReturnValue([mockWindow]);
    performOAuthFlowMock
      .mockRejectedValueOnce(createMcpDcrRequiresUserClientIdError('test-server'))
      .mockRejectedValueOnce('retry failed');
    const pending = McpAuthService.getInstance().getTokenForServer(
      'retry-server',
      makeGenericMetadata(),
      { cfg },
    );
    let call = await waitForIpc('mcpAuth:showConsent');
    mcpAuthPromptRegistry.takeConsent(call[1].requestId)?.('allow-this-time');
    call = await waitForIpc('mcpAuth:requestClientId');
    mcpAuthPromptRegistry.takeClientId(call[1].requestId)?.({ clientId: 'manual-client' });
    await expect(pending).rejects.toBe('retry failed');
  });

  it('cancels DCR fallback for cancelled and malformed client responses', async () => {
    mockGetAllWindows.mockReturnValue([mockWindow]);
    const service = McpAuthService.getInstance();

    performOAuthFlowMock.mockRejectedValueOnce(createMcpDcrRequiresUserClientIdError('test-server'));
    let pending = service.getTokenForServer('test-server', makeGenericMetadata(), { cfg: makeCfg() });
    let call = await waitForIpc('mcpAuth:showConsent');
    mcpAuthPromptRegistry.takeConsent(call[1].requestId)?.('allow-this-time');
    call = await waitForIpc('mcpAuth:requestClientId');
    mcpAuthPromptRegistry.takeClientId(call[1].requestId)?.({ cancelled: true });
    await expect(pending).rejects.toThrow('MCP_AUTH_CANCELLED');

    mockWebContents.send.mockClear();
    performOAuthFlowMock.mockRejectedValueOnce(createMcpDcrRequiresUserClientIdError('test-server'));
    pending = service.getTokenForServer('test-server', makeGenericMetadata(), { cfg: makeCfg() });
    call = await waitForIpc('mcpAuth:showConsent');
    mcpAuthPromptRegistry.takeConsent(call[1].requestId)?.('allow-this-time');
    call = await waitForIpc('mcpAuth:requestClientId');
    mcpAuthPromptRegistry.takeClientId(call[1].requestId)?.({} as any);
    await expect(pending).rejects.toThrow('MCP_AUTH_CANCELLED');
  });
});

describe('McpAuthService — prompt lifecycle and window selection', () => {
  it('resolves consent and client-id callbacks and removes abort listeners', async () => {
    mockGetAllWindows.mockReturnValue([mockWindow]);
    const controller = new AbortController();
    const removeSpy = vi.spyOn(controller.signal, 'removeEventListener');
    const service = McpAuthService.getInstance() as any;

    const consent = service.requestConsent('server', 'Provider', { signal: controller.signal });
    let call = await waitForIpc('mcpAuth:showConsent');
    const consentHandler = mcpAuthPromptRegistry.takeConsent(call[1].requestId)!;
    consentHandler('allow-always');
    consentHandler('cancel');
    await expect(consent).resolves.toBe('allow-always');

    mockWebContents.send.mockClear();
    const client = service.requestClientIdFromUser({
      serverName: 'server',
      metadata: makeGenericMetadata(),
      cfg: makeCfg(),
      redirectUri: 'http://127.0.0.1/callback',
    }, { signal: controller.signal });
    call = await waitForIpc('mcpAuth:requestClientId');
    const clientHandler = mcpAuthPromptRegistry.takeClientId(call[1].requestId)!;
    clientHandler({ clientId: 'client' });
    clientHandler({ cancelled: true });
    await expect(client).resolves.toEqual({ clientId: 'client' });
    expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('cancels both prompts when aborted after dispatch', async () => {
    mockGetAllWindows.mockReturnValue([mockWindow]);
    const service = McpAuthService.getInstance() as any;
    let controller = new AbortController();
    const consent = service.requestConsent('server', 'Provider', { signal: controller.signal });
    await waitForIpc('mcpAuth:showConsent');
    controller.abort();
    await expect(consent).resolves.toBe('cancel');

    mockWebContents.send.mockClear();
    controller = new AbortController();
    const client = service.requestClientIdFromUser({
      serverName: 'server',
      metadata: makeGenericMetadata(),
      cfg: makeCfg(),
      redirectUri: 'http://127.0.0.1/callback',
    }, { signal: controller.signal });
    await waitForIpc('mcpAuth:requestClientId');
    controller.abort();
    await expect(client).resolves.toEqual({ cancelled: true });
  });

  it('cancels both prompts when IPC dispatch throws', async () => {
    mockGetAllWindows.mockReturnValue([mockWindow]);
    const service = McpAuthService.getInstance() as any;
    mockWebContents.send.mockImplementationOnce(() => { throw new Error('renderer gone'); });
    await expect(service.requestConsent('server', 'Provider')).resolves.toBe('cancel');
    mockWebContents.send.mockImplementationOnce(() => { throw 'renderer gone'; });
    await expect(service.requestClientIdFromUser({
      serverName: 'server',
      metadata: makeGenericMetadata(),
      cfg: makeCfg(),
      redirectUri: 'http://127.0.0.1/callback',
    })).resolves.toEqual({ cancelled: true });
  });

  it('cancels direct prompts for a missing window and a pre-aborted signal', async () => {
    const service = McpAuthService.getInstance() as any;
    await expect(service.requestClientIdFromUser({
      serverName: 'server',
      metadata: makeGenericMetadata(),
      cfg: makeCfg(),
      redirectUri: 'http://127.0.0.1/callback',
    })).resolves.toEqual({ cancelled: true });

    const controller = new AbortController();
    controller.abort();
    await expect(service.requestConsent(
      'server',
      'Provider',
      { signal: controller.signal },
    )).resolves.toBe('cancel');
  });

  it('handles a non-Error consent dispatch failure', async () => {
    mockGetAllWindows.mockReturnValue([mockWindow]);
    mockWebContents.send.mockImplementationOnce(() => { throw 'renderer gone'; });
    await expect((McpAuthService.getInstance() as any).requestConsent('server', 'Provider'))
      .resolves.toBe('cancel');
  });

  it('uses providerLabel when fallback instructions omit a label', async () => {
    fallbackState.label = undefined;
    mockGetAllWindows.mockReturnValue([mockWindow]);
    const pending = (McpAuthService.getInstance() as any).requestClientIdFromUser({
      serverName: 'server',
      metadata: makeGenericMetadata({ providerLabel: 'Metadata Provider' }),
      cfg: makeCfg(),
      redirectUri: 'http://127.0.0.1/callback',
    });
    const call = await waitForIpc('mcpAuth:requestClientId');
    expect(call[1].providerLabel).toBe('Metadata Provider');
    mcpAuthPromptRegistry.takeClientId(call[1].requestId)?.({ cancelled: true });
    await expect(pending).resolves.toEqual({ cancelled: true });
  });

  it('suppresses a non-Error interaction-listener failure and supports unsubscribe', async () => {
    mockGetAllWindows.mockReturnValue([mockWindow]);
    const listener = vi.fn(() => { throw 'listener failed'; });
    const unsubscribe = McpAuthService.onInteraction(listener);
    const service = McpAuthService.getInstance() as any;
    let pending = service.requestConsent('server', 'Provider');
    let call = await waitForIpc('mcpAuth:showConsent');
    mcpAuthPromptRegistry.takeConsent(call[1].requestId)?.('cancel');
    await expect(pending).resolves.toBe('cancel');
    expect(listener).toHaveBeenCalledOnce();

    unsubscribe();
    mockWebContents.send.mockClear();
    pending = service.requestConsent('server', 'Provider');
    call = await waitForIpc('mcpAuth:showConsent');
    mcpAuthPromptRegistry.takeConsent(call[1].requestId)?.('cancel');
    await pending;
    expect(listener).toHaveBeenCalledOnce();
  });

  it('skips destroyed, child, screenshot, debug, and throwing windows before selecting the app window', async () => {
    const unusable = [
      { ...mockWindow, isDestroyed: () => true },
      { ...mockWindow, webContents: { ...mockWebContents, getURL: () => { throw new Error('gone'); } } },
      { ...mockWindow, webContents: { ...mockWebContents, getURL: () => 'screenshot.html' } },
      { ...mockWindow, getParentWindow: () => ({}) },
      { ...mockWindow, getTitle: () => 'Debug Tools' },
      mockWindow,
    ];
    mockGetAllWindows.mockReturnValue(unusable as any);
    const pending = (McpAuthService.getInstance() as any).requestConsent('server', 'Provider');
    const call = await waitForIpc('mcpAuth:showConsent');
    mcpAuthPromptRegistry.takeConsent(call[1].requestId)?.('allow-this-time');
    await expect(pending).resolves.toBe('allow-this-time');
  });
});

describe('McpAuthService — credential clearing', () => {
  it('forwards default token scope and explicit all scope to the provider cache', async () => {
    const service = McpAuthService.getInstance();
    const cfg = makeCfg();
    const key = getMcpOAuthServerKey('test-server', cfg);
    storeImpl[key] = {
      serverName: 'test-server',
      serverUrl: cfg.url,
      accessToken: 'token',
      refreshToken: 'refresh',
      expiresAt: 100,
      clientId: 'client',
    };
    await service.clearOAuthForServer('test-server', cfg);
    expect(storeImpl[key]).toMatchObject({ accessToken: '', expiresAt: 0, clientId: 'client' });
    await service.clearOAuthForServer('test-server', cfg, 'all');
    expect(storeImpl[key]).toBeUndefined();
  });
});
